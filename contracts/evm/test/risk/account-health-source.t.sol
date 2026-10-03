// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Types} from "../../src/shared/Types.sol";
import {AccountFactory} from "../../src/monad/credit/AccountFactory.sol";
import {AccountHealthSource} from "../../src/monad/risk/AccountHealthSource.sol";

contract AccountSourceFixture {
    function snapshot(bytes32, bytes32, uint256, uint256) external pure returns (Types.HealthSnapshot memory result) {
        result.cash = 7;
    }
    function freeCash(bytes32, bytes32, uint256) external pure returns (uint256) { return 7; }
}
contract AccountCoreFixture {
    mapping(bytes32 => address) public creditAccount;
    mapping(bytes32 => address) public creditBorrower;
    function bind(bytes32 id, address borrower, address account) external { creditBorrower[id] = borrower; creditAccount[id] = account; }
}
contract ForgedAccount {
    bytes32 public creditId;
    address public borrower;
    address public core;
    constructor(bytes32 id, address user, address core_) { creditId = id; borrower = user; core = core_; }
}
contract AccountHealthSourceTest is Test {
    bytes32 constant CREDIT = keccak256("credit");
    address constant BORROWER = address(0xB0B);
    AccountFactory factory;
    AccountCoreFixture core;
    AccountHealthSource source;

    function setUp() public {
        factory = new AccountFactory();
        core = new AccountCoreFixture();
        source = new AccountHealthSource(address(core), address(new AccountSourceFixture()), address(factory));
    }
    function testCounterfeitIdentityCannotAuthorizeHealthOrCash() public {
        core.bind(CREDIT, BORROWER, address(new ForgedAccount(CREDIT, BORROWER, address(core))));
        assertFalse(source.accountValid(CREDIT));
        vm.expectRevert(AccountHealthSource.InvalidAccount.selector);
        source.snapshot(CREDIT, bytes32(uint256(1)), 1, 1);
        vm.expectRevert(AccountHealthSource.InvalidAccount.selector);
        source.freeCash(CREDIT, bytes32(uint256(1)), 1);
    }
    function testAuthenticAccountIsAcceptedAndFactoryChangeInvalidatesIt() public {
        vm.prank(BORROWER);
        address account = factory.create(CREDIT, BORROWER, address(core));
        core.bind(CREDIT, BORROWER, account);
        assertTrue(source.accountValid(CREDIT));
        assertEq(source.freeCash(CREDIT, bytes32(uint256(1)), 1), 7);
        assertEq(source.snapshot(CREDIT, bytes32(uint256(1)), 1, 1).cash, 7);
        vm.etch(address(factory), hex"00");
        assertFalse(source.accountValid(CREDIT));
    }
    function testOtherWalletCannotPreemptBorrowerAccount() public {
        vm.prank(address(0xBAD));
        vm.expectRevert(AccountFactory.Invalid.selector);
        factory.create(CREDIT, BORROWER, address(core));
        vm.prank(BORROWER);
        assertTrue(factory.create(CREDIT, BORROWER, address(core)) != address(0));
    }
    function testDifferentCoreOrBorrowerFailsAuthentication() public {
        address other = address(new AccountCoreFixture());
        vm.prank(BORROWER);
        address account = factory.create(CREDIT, BORROWER, other);
        core.bind(CREDIT, BORROWER, account);
        assertFalse(source.accountValid(CREDIT));
    }
}
