// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FullMath} from "../../shared/FullMath.sol";

contract ReadProgram {
    enum Op { Constant, Account, Credit, Index, Amount, BlockNumber, Word, WordOrZero, Length,
        Add, Subtract, MultiplyDivide, Minimum, Maximum, Equal, Less, LessEqual, And, Or, Not, Select, Assert,
        SignedAdd, SignedSubtract, SignedMinimum }
    struct Step { Op op; uint16 a; uint16 b; uint16 c; uint256 value; }
    struct Argument { uint16 word; uint16 register; }
    struct Query { address target; bytes data; Argument[] arguments; bytes32 expectedHash; uint32 gasLimit; }
    struct Program { Query[] queries; Step[] steps; uint16[] outputs; }
    struct Context { address target; address account; bytes32 creditId; uint256 index; uint256 amount; }
    address public immutable governance;
    mapping(bytes32 => Program) private programs;
    mapping(bytes32 => bytes32) public programHashes;
    uint256 public constant MAX_RETURN = 8192;
    error Invalid();
    error ReadFailed();

    constructor(address governance_) { if (governance_ == address(0)) revert Invalid(); governance = governance_; }

    function configure(bytes32 id, Program calldata program) external {
        if (msg.sender != governance || id == bytes32(0)
            || program.queries.length > 16 || program.steps.length == 0 || program.steps.length > 1024
            || program.outputs.length == 0 || program.outputs.length > 32) revert Invalid();
        bytes32 hash = keccak256(abi.encode(program));
        if (programHashes[id] != bytes32(0)) { if (programHashes[id] != hash) revert Invalid(); return; }
        uint256 budget;
        Program storage stored = programs[id];
        for (uint256 i; i < program.queries.length; ++i) {
            Query calldata query = program.queries[i];
            if (query.data.length < 4 || query.data.length > 1028 || (query.data.length - 4) % 32 != 0
                || query.gasLimit == 0 || query.gasLimit > 500_000 || query.arguments.length > 32
                || query.target != address(0) && query.target.code.length == 0) revert Invalid();
            budget += query.gasLimit;
            stored.queries.push();
            Query storage copy = stored.queries[i];
            copy.target = query.target; copy.data = query.data; copy.expectedHash = query.expectedHash; copy.gasLimit = query.gasLimit;
            for (uint256 j; j < query.arguments.length; ++j) {
                Argument calldata argument = query.arguments[j];
                if (4 + uint256(argument.word) * 32 + 32 > query.data.length || argument.register >= program.steps.length) revert Invalid();
                for (uint256 k; k < j; ++k) if (query.arguments[k].word == argument.word) revert Invalid();
                copy.arguments.push(argument);
            }
        }
        if (budget > 1_000_000) revert Invalid();
        for (uint256 i; i < program.steps.length; ++i) {
            Step calldata step = program.steps[i];
            if (step.a >= program.steps.length || step.b >= program.steps.length || step.c >= program.steps.length) revert Invalid();
            if (step.op == Op.Word || step.op == Op.WordOrZero || step.op == Op.Length) {
                if (step.value >= program.queries.length || step.op != Op.Length && step.a >= i) revert Invalid();
                Query calldata query = program.queries[step.value];
                for (uint256 j; j < query.arguments.length; ++j) if (query.arguments[j].register >= i) revert Invalid();
            } else if (step.op >= Op.Add) {
                if (step.a >= i || step.op != Op.Not && step.op != Op.Assert && step.b >= i
                    || (step.op == Op.MultiplyDivide || step.op == Op.Select) && step.c >= i) revert Invalid();
            }
            stored.steps.push(step);
        }
        for (uint256 i; i < program.outputs.length; ++i) {
            if (program.outputs[i] >= program.steps.length) revert Invalid();
            stored.outputs.push(program.outputs[i]);
        }
        programHashes[id] = hash;
    }

    function targets(bytes32 id, address contextualTarget) external view returns (address[] memory result) {
        if (programHashes[id] == bytes32(0)) revert Invalid();
        Query[] storage queries = programs[id].queries;
        result = new address[](queries.length);
        for (uint256 i; i < queries.length; ++i) result[i] = queries[i].target == address(0) ? contextualTarget : queries[i].target;
    }

    function quote(bytes32 id, address target, uint256 amount) external view returns (uint256 available, uint256 proceeds) {
        if (amount == 0 || programHashes[id] == bytes32(0) || programs[id].outputs.length != 2) return (0, 0);
        try this.read(id, Context(target, address(0), bytes32(0), 0, amount)) returns (uint256[] memory result) {
            if (result[0] > amount || result[1] > uint256(type(int256).max)) return (0, 0);
            return (result[0], result[1]);
        } catch { return (0, 0); }
    }

    function read(bytes32 id, Context calldata context) external view returns (uint256[] memory result) {
        if (programHashes[id] == bytes32(0)) revert Invalid();
        Program storage program = programs[id];
        uint256[] memory registers = new uint256[](program.steps.length);
        bytes[] memory reads = new bytes[](program.queries.length);
        bool[] memory loaded = new bool[](program.queries.length);
        for (uint256 i; i < program.steps.length; ++i) {
            Step storage step = program.steps[i];
            Op op = step.op;
            uint256 a = registers[step.a]; uint256 b = registers[step.b]; uint256 c = registers[step.c];
            uint256 value;
            if (op == Op.Constant) value = step.value;
            else if (op == Op.Account) value = uint256(uint160(context.account));
            else if (op == Op.Credit) value = uint256(context.creditId);
            else if (op == Op.Index) value = context.index;
            else if (op == Op.Amount) value = context.amount;
            else if (op == Op.BlockNumber) value = block.number;
            else if (op == Op.Word || op == Op.WordOrZero || op == Op.Length) {
                uint256 queryId = step.value;
                if (!loaded[queryId]) {
                    Query storage query = program.queries[queryId];
                    bytes memory data = query.data;
                    for (uint256 j; j < query.arguments.length; ++j) {
                        uint256 word = registers[query.arguments[j].register];
                        uint256 offset = 36 + uint256(query.arguments[j].word) * 32;
                        assembly ("memory-safe") { mstore(add(data, offset), word) }
                    }
                    address target = query.target == address(0) ? context.target : query.target;
                    if (target.code.length == 0) revert ReadFailed();
                    bytes memory answer;
                    bool ok;
                    uint256 gasLimit = query.gasLimit;
                    assembly ("memory-safe") {
                        ok := staticcall(gasLimit, target, add(data, 32), mload(data), 0, 0)
                        let size := returndatasize()
                        if gt(size, 8192) { ok := 0 size := 0 }
                        answer := mload(0x40)
                        mstore(answer, size)
                        returndatacopy(add(answer, 32), 0, size)
                        mstore(0x40, and(add(add(answer, 63), size), not(31)))
                    }
                    if (!ok || answer.length % 32 != 0 || query.expectedHash != bytes32(0)
                        && keccak256(answer) != query.expectedHash) revert ReadFailed();
                    reads[queryId] = answer; loaded[queryId] = true;
                }
                bytes memory answer = reads[queryId];
                if (op == Op.Length) value = answer.length / 32;
                else if (a >= answer.length / 32) { if (op != Op.WordOrZero) revert ReadFailed(); }
                else assembly ("memory-safe") { value := mload(add(add(answer, 32), mul(a, 32))) }
            } else if (op == Op.Add) value = a + b;
            else if (op == Op.Subtract) value = a - b;
            else if (op == Op.MultiplyDivide) value = FullMath.mulDiv(a, b, c, false);
            else if (op == Op.Minimum) value = a < b ? a : b;
            else if (op == Op.Maximum) value = a > b ? a : b;
            else if (op == Op.Equal) value = a == b ? 1 : 0;
            else if (op == Op.Less) value = a < b ? 1 : 0;
            else if (op == Op.LessEqual) value = a <= b ? 1 : 0;
            else if (op == Op.And) value = a != 0 && b != 0 ? 1 : 0;
            else if (op == Op.Or) value = a != 0 || b != 0 ? 1 : 0;
            else if (op == Op.Not) value = a == 0 ? 1 : 0;
            else if (op == Op.Select) value = a != 0 ? b : c;
            else if (op == Op.Assert) { if (a == 0) revert ReadFailed(); }
            else if (op == Op.SignedAdd) value = uint256(int256(a) + int256(b));
            else if (op == Op.SignedSubtract) value = uint256(int256(a) - int256(b));
            else if (op == Op.SignedMinimum) value = int256(a) < int256(b) ? a : b;
            else revert Invalid();
            registers[i] = value;
        }
        result = new uint256[](program.outputs.length);
        for (uint256 i; i < result.length; ++i) result[i] = registers[program.outputs[i]];
    }
}
