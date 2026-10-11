import { acceptanceCases, type AcceptanceCaseId, type IntegrationSuite } from "@termbook/schema";
import { IntegrationValidationRunner, type ValidationCall } from "@termbook/sdk";
import { encodeFunctionData, parseAbi, type Address, type Hex } from "viem";
import { Fixture, signature, USDC, word, type Facility } from "./acceptance-fixture.js";
import { DeploymentFixture } from "./deployment-fixture.js";
import { orderScenarios, orderCases } from "./orders-acceptance.js";

export const exclusions: IntegrationSuite["exclusions"] = [
  ...(["forced_cancel", "asynchronous_failure", "pending_limit", "partial_fill_slots", "duplicate_claim"] as const).map((id) => ({ id,
    reason: "This integration admits immediate fill-or-kill market trades only; it creates no pending orders or claims." })),
  { id: "forced_reduce", reason: "Spot holdings are sold by the forced-close path; this integration exposes no derivative position-reduction action." },
  { id: "retention_authorization", reason: "This atomic spot integration does not register a retention verifier or planner, so retention cannot be authorized." },
];
export const kuru_acceptance_cases = (Object.keys(acceptanceCases) as AcceptanceCaseId[]).filter((id) => !exclusions.some((e) => e.id === id));
type Runner = IntegrationValidationRunner;

export async function createScenarios(input: unknown, actors: IntegrationSuite["actors"]) {
  if (!(input instanceof Fixture) || Object.entries(actors).some(([role, address]) => address.toLowerCase() !== input.actors[role as keyof typeof actors].toLowerCase())) throw new Error("validation-kuru-fixture-invalid");
  const f = input;
  const call = async (name: string, method: string, args: readonly unknown[] = [], from = actors.borrower, to = f.addresses[name]!): Promise<ValidationCall> =>
    ({ to, from: from as Address, signature: await signature(name, method), args });
  const core = (method: string, args: readonly unknown[] = [], from = actors.borrower) => call("TermbookCore", method, args, from);
  const read = async (r: Runner, id: string, name: string, method: string, args: readonly unknown[], phase: "before" | "after", target = f.component(name, method).target) =>
    r.observe({ id, target, from: actors.borrower as Address, signature: await signature(f.component(name, method).name, method), args, phase });
  const assert = (r: Runner, label: string, observation: string, operator: "eq" | "ne" | "gt" | "le" | "lt" | "ge", value: string | bigint | boolean, index = 0) =>
    r.assert({ label, left: { observation, index }, operator, right: { value: String(value) } });
  const same = (r: Runner, name: string) => r.assert({ label: `${name} unchanged`, left: { observation: `after_${name}`, index: 0 }, operator: "eq", right: { observation: `before_${name}`, index: 0 } });
  const snapshot = async (r: Runner, v: Facility, phase: "before" | "after") => {
    await read(r, `${phase}_debt`, "TermbookCore", "creditDebt", [v.id], phase);
    await read(r, `${phase}_native`, "SpotAcceptanceProbe", "nativeBalance", [v.account], phase);
    await read(r, `${phase}_positions`, "AtomicSpotModule", "positionCount", [v.id, v.account], phase);
    await r.observe({ id: `${phase}_cash`, target: USDC, from: actors.borrower as Address,
      signature: "function balanceOf(address) view returns(uint256)", args: [v.account], phase });
  };
  const rejection = async (r: Runner, valid: ValidationCall, invalid: ValidationCall) => {
    const control = await r.simulate("control", valid);
    if (control.reverted) throw new Error("validation-control-reverted");
    const rejected = await r.simulate("rejected", invalid, "control");
    if (!rejected.reverted) throw new Error("validation-unsafe-action-accepted");
  };
  const unchanged = async (r: Runner) => { for (const key of ["debt", "native", "positions", "cash"]) await same(r, key); };
  const buy = async (v: Facility) => { await f.refresh(); await f.transact(await f.execution(v)); };
  const sellPrice = (v: Facility) => f.chain.getBalance({ address: v.account }).then((balance) => f.bid - (balance > 0n ? 10n ** 20n / balance + 2n : 1n));
  const sell = async (v: Facility) => { await f.refresh(await sellPrice(v)); return f.execution(v, false, await f.chain.getBalance({ address: v.account })); };
  const exit = async (v: Facility) => { await f.refresh(f.bid - 1n); return (await f.read("AtomicSpotModule", "nextExitStep", [v.id, v.account]))[1] as Hex; };
  const liquidation = async (v: Facility, full: boolean) => {
    await buy(v); await f.refresh(1n); await f.call("TermbookCore", "recordHealth", [v.id]);
    if (full) await f.call("TermbookCore", "startClosing", [v.id]);
    await f.call("TermbookCore", "startLiquidation", [v.id]); await f.refresh(f.bid - 1n);
  };
  const cureSetup = async (v: Facility) => {
    await liquidation(v, false); await f.call("TermbookCore", "recoverCollateral", [v.id, 500n], f.actors.keeper);
    await f.call("TermbookCore", "recordHealth", [v.id]);
  };
  const cases: Partial<Record<AcceptanceCaseId, (r: Runner) => Promise<void>>> = {};
  for (const id of kuru_acceptance_cases) {
    const v = f.facilities.get(id);
    if (!v) throw new Error(`validation-facility-missing:${id}`);
    cases[id] = async (r) => {
      await f.refresh();
      switch (id) {
        case "source_identity": {
          await r.verifyPins(); await snapshot(r, v, "before");
          const result = await r.simulate("valid", await f.execution(v)); if (result.reverted) throw new Error("validation-source-control-reverted");
          await read(r, "dependencies", "IntegrationRegistry", "dependenciesValid", [f.bundle], "after");
          await snapshot(r, v, "after"); await assert(r, "Pinned dependencies are valid", "dependencies", "eq", true); await unchanged(r); break;
        }
        case "account_permissions": case "unauthorized_module": case "ownership_escape": {
          await f.transact({ to: USDC, from: f.actors.borrower, signature: "function transfer(address,uint256) returns(bool)", args: [v.account, 100n] });
          await snapshot(r, v, "before");
          const valid = await call("CreditAccount", "transferToken", [USDC, f.actors.borrower, 100n], f.addresses.TermbookCore, v.account);
          await rejection(r, valid, { ...valid, from: (id === "account_permissions" ? actors.borrower : actors.unauthorized) as Address });
          await snapshot(r, v, "after"); await unchanged(r); break;
        }
        case "reentrancy": {
          await snapshot(r, v, "before");
          await read(r, "callback_before", "SpotAcceptanceProbe", "nativeBalance", [f.addresses.SpotCallbackFixture], "before");
          await rejection(r, await call("SpotCallbackFixture", "run", [false]), await call("SpotCallbackFixture", "run", [true]));
          await read(r, "callback_after", "SpotAcceptanceProbe", "nativeBalance", [f.addresses.SpotCallbackFixture], "after");
          await r.assert({ label: "Nested trade rolls back the callback account balance", left: { observation: "callback_after", index: 0 }, operator: "eq", right: { observation: "callback_before", index: 0 } });
          await snapshot(r, v, "after"); await unchanged(r); break;
        }
        case "bounded_calls": case "action_schemas": case "insufficient_limit": case "slippage": {
          await snapshot(r, v, "before"); const valid = await f.execution(v);
          const invalid = await f.execution(v, true, id === "insufficient_limit" ? 10_001n : 10_000n, (action, auth) => {
            if (id === "bounded_calls") action.calls[0].target = USDC;
            if (id === "action_schemas") action.capability = word("unregistered_capability");
            if (id === "slippage") { auth.price.slippageBps = 101; }
          });
          await rejection(r, valid, invalid); await snapshot(r, v, "after"); await unchanged(r); break;
        }
        case "replay": {
          await buy(v); const valid = await sell(v);
          const invalid = await f.execution(v, false, await f.chain.getBalance({ address: v.account }), (_, auth) => { auth.nonce = 1n; });
          await snapshot(r, v, "before"); await rejection(r, valid, invalid); await snapshot(r, v, "after"); await unchanged(r); break;
        }
        case "portfolio_state": case "portfolio_valuation": case "financed_costs": case "pricing": {
          if (id === "financed_costs") await f.transact({ to: USDC, from: f.actors.borrower, signature: "function transfer(address,uint256) returns(bool)", args: [v.account, 3000n] });
          await snapshot(r, v, "before");
          if (id === "pricing") {
            await rejection(r, await f.execution(v), await f.execution(v, true, 10_000n, (action) => {
              action.calls[0].data = encodeFunctionData({ abi: parseAbi(["function trade(bytes32,uint256,uint256)"]), functionName: "trade", args: [f.buyRoute, 10_000n, 1n] });
            }));
          } else {
            const tx = await r.transact(await f.execution(v, true, 10_000n, (_, auth) => { if (id === "financed_costs") auth.drawAmount = 7000n; }));
            if (!tx.succeeded) throw new Error("validation-buy-reverted");
            await read(r, "valuation", "AtomicSpotModule", "readAppValue", [v.id, v.account, USDC], "after");
            await assert(r, "Recoverable app value is positive", "valuation", "gt", 0n);
            await assert(r, "Haircut is applied", "valuation", "eq", 9500n, 1);
            const native = await f.chain.getBalance({ address: v.account });
            const [price] = await f.read("OracleRegistry", "read", [f.feedId]);
            await assert(r, "Value cannot exceed independent oracle backing", "valuation", "le", native * price / 10n ** 30n);
            await r.observe({ id: "allowance", target: USDC, from: actors.borrower as Address, signature: "function allowance(address,address) view returns(uint256)", args: [v.account, f.addresses.AtomicSpotRouter], phase: "after" });
            await assert(r, "Trade allowance is cleared", "allowance", "eq", 0n);
          }
          await snapshot(r, v, "after");
          if (id === "pricing") await unchanged(r);
          else { await assert(r, "No prior debt", "before_debt", "eq", 0n); await assert(r, "Only shortfall is financed", "after_debt", "eq", id === "financed_costs" ? 7000n : 10_000n); await assert(r, "One controlled holding", "after_positions", "eq", 1n); await assert(r, "MON lands in the account", "after_native", "gt", 0n); }
          break;
        }
        case "pause_failure": case "stale_oracle": case "permission_loss": case "upgrade_failure": {
          const request = await f.execution(v, true, 10_000n, (_, auth) => { auth.deadline += 300n; }); await snapshot(r, v, "before");
          const control = await r.simulate("control", request); if (control.reverted) throw new Error("validation-control-reverted");
          if (id === "pause_failure") await f.call("TermbookCore", "setPaused", [true]);
          else if (id === "permission_loss") await f.call("PriceFeedFixture", "setPermission", [false]);
          else if (id === "stale_oracle") {
            const now = (await f.chain.getBlock()).timestamp;
            await f.rpcCall("evm_setNextBlockTimestamp", [Number(now + 61n)]); await f.mine();
          }
          else await f.call("TestnetUpgradeGuard", "revoke", [], f.actors.borrower, f.guards[0]);
          const tx = await r.transact(request); if (tx.succeeded) throw new Error(`validation-failure-accepted:${id}`);
          await snapshot(r, v, "after"); await unchanged(r);
          if (id === "pause_failure") await f.call("TermbookCore", "setPaused", [false]);
          if (id === "permission_loss") await f.call("PriceFeedFixture", "setPermission", [true]);
          if (id === "upgrade_failure") await f.restoreGuard();
          await f.refresh(); break;
        }
        case "forced_close": case "forced_settlement": case "recovery_isolation": case "recovery_interruption": {
          await liquidation(v, true); const instruction = await exit(v); await snapshot(r, v, "before");
          if (id === "recovery_isolation") {
            const other = f.facilities.get("isolation_control")!;
            await buy(other); await f.refresh(f.bid - 1n);
            await read(r, "other_before", "SpotAcceptanceProbe", "nativeBalance", [other.account], "before");
            const tx = await r.transact(await core("recoverApp", [v.id, await exit(v)], actors.keeper));
            if (!tx.succeeded) throw new Error("validation-isolated-recovery-reverted");
            await read(r, "other_after", "SpotAcceptanceProbe", "nativeBalance", [other.account], "after");
            await snapshot(r, v, "after");
            await r.assert({ label: "Recovery leaves the other account's holdings intact", left: { observation: "other_after", index: 0 }, operator: "eq", right: { observation: "other_before", index: 0 } });
            await assert(r, "Recovered account exits", "after_positions", "eq", 0n); break;
          }
          if (id === "recovery_interruption") {
            await f.call("TestnetUpgradeGuard", "revoke", [], f.actors.borrower, f.guards[0]);
            const failed = await r.transact(await core("recoverApp", [v.id, instruction], actors.keeper)); if (failed.succeeded) throw new Error("validation-interrupted-recovery-accepted");
            await read(r, "interrupted_balance", "SpotAcceptanceProbe", "nativeBalance", [v.account], "after");
            await r.assert({ label: "Failed recovery preserves holdings", left: { observation: "interrupted_balance", index: 0 }, operator: "eq", right: { observation: "before_native", index: 0 } });
            await f.restoreGuard(f.bid - 1n);
          }
          const recovered = await r.transact(await core("recoverApp", [v.id, await exit(v)], actors.keeper)); if (!recovered.succeeded) throw new Error("validation-recovery-reverted");
          if (id === "forced_settlement") {
            const cash = await f.chain.readContract({ address: USDC, abi: parseAbi(["function balanceOf(address) view returns(uint256)"]), functionName: "balanceOf", args: [v.account] });
            const repaid = await r.transact(await core("recoverAccountCash", [v.id, cash], actors.keeper)); if (!repaid.succeeded) throw new Error("validation-recovery-repayment-reverted");
            const shortfall = await f.read("TermbookCore", "creditDebt", [v.id]);
            if (shortfall > 0n) {
              const seized = await r.transact(await core("recoverCollateral", [v.id, shortfall], actors.keeper));
              if (!seized.succeeded) throw new Error("validation-collateral-repayment-reverted");
            }
            const finalized = await r.transact(await call("HouseVault", "finalizeRecovery", [v.id], actors.keeper));
            if (!finalized.succeeded) throw new Error("validation-house-recovery-finalization-reverted");
          }
          await snapshot(r, v, "after"); await assert(r, "Position existed", "before_positions", "eq", 1n); await assert(r, "Keeper closes holdings", "after_positions", "eq", 0n);
          if (id === "forced_settlement") { await assert(r, "Debt existed before recovery", "before_debt", "gt", 0n); await assert(r, "Keeper fully settles House debt", "after_debt", "eq", 0n); }
          else await assert(r, "USDC proceeds stay controlled", "after_cash", "gt", 0n);
          break;
        }
        case "debt_free_release": case "failed_return": {
          await f.call("TermbookCore", "startClosing", [v.id]); await snapshot(r, v, "before");
          if (id === "failed_return") {
            await rejection(r, await core("authorizeReturn", [v.id, v.lock, v.collateral]), await core("authorizeReturn", [v.id, word("foreign lock"), v.collateral]));
            await snapshot(r, v, "after"); await unchanged(r); break;
          }
          const returned = await r.transact(await core("authorizeReturn", [v.id, v.lock, v.collateral])); if (!returned.succeeded) throw new Error("validation-return-reverted");
          const closed = await r.transact(await core("finishClose", [v.id])); if (!closed.succeeded) throw new Error("validation-close-reverted");
          await snapshot(r, v, "after"); await read(r, "released", "CreditAccount", "released", [], "after", v.account);
          await assert(r, "Debt stays zero", "before_debt", "eq", 0n); await assert(r, "Debt-free account released", "released", "eq", true); await assert(r, "No debt at release", "after_debt", "eq", 0n); break;
        }
        case "proceeds_return": {
          await buy(v); const request = await sell(v); await snapshot(r, v, "before");
          const tx = await r.transact(request); if (!tx.succeeded) throw new Error("validation-sell-reverted");
          await r.observe({ id: "sale_cash", target: USDC, from: actors.borrower as Address,
            signature: "function balanceOf(address) view returns(uint256)", args: [v.account], phase: "after" });
          await read(r, "sale_debt", "TermbookCore", "creditDebt", [v.id], "after");
          await assert(r, "Sale returns account USDC", "sale_cash", "gt", 0n);
          await r.assert({ label: "Selling does not automatically repay", left: { observation: "sale_debt", index: 0 }, operator: "eq", right: { observation: "before_debt", index: 0 } });
          const repaid = await r.transact(await core("repayAvailableCash", [v.id])); if (!repaid.succeeded) throw new Error("validation-cash-repayment-reverted");
          const shortfall = await f.read("TermbookCore", "creditDebt", [v.id]);
          if (shortfall > 0n) {
            await f.transact({ to: USDC, from: f.actors.borrower, signature: "function approve(address,uint256) returns(bool)", args: [f.addresses.TermbookCore, shortfall] });
            const paid = await r.transact(await core("repay", [v.id, shortfall])); if (!paid.succeeded) throw new Error("validation-shortfall-repayment-reverted");
          }
          for (const [method, args] of [["startClosing", [v.id]], ["authorizeReturn", [v.id, v.lock, v.collateral]], ["finishClose", [v.id]]] as const) {
            const finished = await r.transact(await core(method, args)); if (!finished.succeeded) throw new Error(`validation-loan-closure-reverted:${method}`);
          }
          await snapshot(r, v, "after"); await read(r, "released", "CreditAccount", "released", [], "after", v.account);
          await assert(r, "Cash starts empty", "before_cash", "eq", 0n); await assert(r, "Loan fully repaid", "after_debt", "eq", 0n);
          await assert(r, "Sale clears position", "after_positions", "eq", 0n); await assert(r, "Closed account releases control", "released", "eq", true); break;
        }
        case "close_interruption": case "duplicate_close": case "zero_cash_close": case "closing_risk_increase": {
          await buy(v); await f.call("TermbookCore", "startClosing", [v.id]); await f.refresh(f.bid - 1n);
          await snapshot(r, v, "before");
          if (id === "closing_risk_increase") {
            await f.refresh();
            const control = f.facilities.get("control")!;
            await rejection(r, await f.execution(control), await f.execution(v)); await snapshot(r, v, "after"); await unchanged(r); break;
          }
          if (id === "close_interruption") {
            const step = (await f.read("TermbookCore", "closeStep", [v.id]))[0];
            await f.call("TestnetUpgradeGuard", "revoke", [], f.actors.borrower, f.guards[0]);
            const tx = await r.transact(await core("advanceClose", [v.id, step])); if (tx.succeeded) throw new Error("validation-interrupted-close-accepted");
            await read(r, "interrupted_balance", "SpotAcceptanceProbe", "nativeBalance", [v.account], "after");
            await r.assert({ label: "Interrupted closure preserves holdings", left: { observation: "interrupted_balance", index: 0 }, operator: "eq", right: { observation: "before_native", index: 0 } });
            await f.restoreGuard(f.bid - 1n);
          }
          const step = (await f.read("TermbookCore", "closeStep", [v.id]))[0];
          const tx = await r.transact(await core("advanceClose", [v.id, step])); if (!tx.succeeded) throw new Error("validation-close-step-reverted");
          if (id === "duplicate_close") {
            const control = f.facilities.get("duplicate_control")!;
            await buy(control); await f.call("TermbookCore", "startClosing", [control.id]); await f.refresh(f.bid - 1n);
            await rejection(r, await core("advanceClose", [control.id, (await f.read("TermbookCore", "closeStep", [control.id]))[0]]), await core("advanceClose", [v.id, step]));
          }
          if (id === "zero_cash_close") { const repayment = await r.transact(await core("repayAvailableCash", [v.id])); if (!repayment.succeeded) throw new Error("validation-close-repayment-reverted"); }
          await snapshot(r, v, "after"); await assert(r, "No free cash before closure", "before_cash", "eq", 0n); await assert(r, "Closure exits holdings", "after_positions", "eq", 0n);
          if (id === "zero_cash_close") await r.assert({ label: "Closure proceeds reduce debt", left: { observation: "after_debt", index: 0 }, operator: "lt", right: { observation: "before_debt", index: 0 } });
          else await assert(r, "Closure produces settlement cash", "after_cash", "gt", 0n); break;
        }
        case "partial_cure": case "maturity_cure": case "default_cure": case "pending_cure": case "full_termination_cure": {
          await cureSetup(v); const control = f.facilities.get("cure_control")!;
          if (id === "partial_cure") {
            await snapshot(r, v, "before"); const tx = await r.transact(await core("cure", [v.id])); if (!tx.succeeded) throw new Error("validation-partial-cure-reverted");
            await snapshot(r, v, "after"); await read(r, "facility", "TermbookCore", "creditFacility", [v.id], "after");
            await assert(r, "Partial cure restores ready", "facility", "eq", 4n); await same(r, "debt"); await same(r, "native"); break;
          }
          if ((await f.read("TermbookCore", "creditFacility", [control.id])) === 4) await cureSetup(control);
          if (id === "maturity_cure") await f.creditField(v.id, "maturity", (await f.chain.getBlock()).timestamp);
          if (id === "default_cure") await f.creditField(v.id, "payment", 3n);
          if (id === "pending_cure") await f.mapping("pendingRemoteReturn", v.id, 1n);
          if (id === "full_termination_cure") await f.call("TermbookCore", "commitFullRecovery", [v.id], f.actors.keeper);
          await f.refresh(f.bid - 1n); await snapshot(r, v, "before");
          await rejection(r, await core("cure", [control.id]), await core("cure", [v.id])); await snapshot(r, v, "after"); await unchanged(r); break;
        }
        case "portfolio_limit": {
          await f.rpcCall("anvil_setBalance", [v.account, `0x${(10n ** 18n).toString(16)}`]); await f.mine();
          await snapshot(r, v, "before"); const control = f.facilities.get("control")!;
          await rejection(r, await f.execution(control), await f.execution(v)); await snapshot(r, v, "after"); await unchanged(r); break;
        }
        case "unsolicited_asset": {
          await snapshot(r, v, "before");
          const tx = await r.transact(await call("MockERC20", "mint", [v.account, 10n ** 18n])); if (!tx.succeeded) throw new Error("validation-donation-reverted");
          await snapshot(r, v, "after"); await read(r, "value", "AtomicSpotModule", "readAppValue", [v.id, v.account, USDC], "after");
          await assert(r, "Unregistered token contributes no app value", "value", "eq", 0n); await unchanged(r); break;
        }
        default: throw new Error(`validation-case-unimplemented:${id}`);
      }
    };
  }
  if (f instanceof DeploymentFixture && f.orderDefinition) return { cases: { ...cases, ...orderScenarios(f) },
    exclusions: exclusions.filter((e) => !orderCases.includes(e.id as typeof orderCases[number])) };
  return { cases, exclusions };
}
