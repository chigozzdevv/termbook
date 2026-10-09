import { readProgramSchema, type ReadProgramDefinition } from "@termbook/schema";
import { encodeAbiParameters, keccak256, parseAbi, type Address, type Hex } from "viem";

export const readProgramTuple = "((address target,bytes data,(uint16 word,uint16 register)[] arguments,bytes32 expectedHash,uint32 gasLimit)[] queries,(uint8 op,uint16 a,uint16 b,uint16 c,uint256 value)[] steps,uint16[] outputs)";
export const readProgramAbi = parseAbi([
  `function configure(bytes32 id,${readProgramTuple} program)`,
  "function targets(bytes32 id,address contextualTarget) view returns (address[])",
  "function programHashes(bytes32) view returns (bytes32)",
  "function read(bytes32 id,(address target,address account,bytes32 creditId,uint256 index,uint256 amount) context) view returns (uint256[])",
]);

export function compile_read_program(input: ReadProgramDefinition) {
  const definition = readProgramSchema.parse(input);
  const program = { queries: definition.queries.map((query) => ({ target: query.target as Address, data: query.data as Hex,
    arguments: query.arguments, expectedHash: query.expected_hash as Hex, gasLimit: query.gas_limit })),
    steps: definition.steps.map((step) => ({ ...step, value: BigInt(step.value) })), outputs: definition.outputs };
  const inputs = parseAbi([`function hash(${readProgramTuple} program)`])[0].inputs;
  const hash = keccak256(encodeAbiParameters(inputs, [program]));
  return { definition, program, hash, id: hash };
}

export class ReadProgramBuilder {
  private readonly queries: ReadProgramDefinition["queries"] = [];
  private readonly steps: ReadProgramDefinition["steps"] = [];
  private step(op: number, a = 0, b = 0, c = 0, value = 0n): number {
    const index = this.steps.length;
    this.steps.push({ op, a, b, c, value: String(value) });
    return index;
  }
  constant(value: bigint): number { return this.step(0, 0, 0, 0, value < 0n ? 2n ** 256n + value : value); }
  account(): number { return this.step(1); }
  credit(): number { return this.step(2); }
  index(): number { return this.step(3); }
  amount(): number { return this.step(4); }
  block_number(): number { return this.step(5); }
  query(target: Address, data: Hex, options: { arguments?: { word: number; register: number }[]; expected_hash?: Hex; gas_limit?: number } = {}): number {
    const id = this.queries.length;
    this.queries.push({ target, data, arguments: options.arguments ?? [], expected_hash: options.expected_hash ?? `0x${"0".repeat(64)}`,
      gas_limit: options.gas_limit ?? 100_000 });
    return id;
  }
  word(query: number, index: number): number { return this.step(6, index, 0, 0, BigInt(query)); }
  word_or_zero(query: number, index: number): number { return this.step(7, index, 0, 0, BigInt(query)); }
  length(query: number): number { return this.step(8, 0, 0, 0, BigInt(query)); }
  add(a: number, b: number): number { return this.step(9, a, b); }
  subtract(a: number, b: number): number { return this.step(10, a, b); }
  multiply_divide(a: number, b: number, c: number): number { return this.step(11, a, b, c); }
  minimum(a: number, b: number): number { return this.step(12, a, b); }
  maximum(a: number, b: number): number { return this.step(13, a, b); }
  equal(a: number, b: number): number { return this.step(14, a, b); }
  less(a: number, b: number): number { return this.step(15, a, b); }
  less_equal(a: number, b: number): number { return this.step(16, a, b); }
  and(a: number, b: number): number { return this.step(17, a, b); }
  or(a: number, b: number): number { return this.step(18, a, b); }
  not(a: number): number { return this.step(19, a); }
  select(a: number, b: number, c: number): number { return this.step(20, a, b, c); }
  assert(a: number): void { this.step(21, a); }
  signed_add(a: number, b: number): number { return this.step(22, a, b); }
  signed_subtract(a: number, b: number): number { return this.step(23, a, b); }
  signed_minimum(a: number, b: number): number { return this.step(24, a, b); }
  finish(outputs: number[]): ReadProgramDefinition { return readProgramSchema.parse({ queries: this.queries, steps: this.steps, outputs }); }
}
