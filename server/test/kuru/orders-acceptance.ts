import type { AcceptanceCaseId } from "@termbook/schema";
import type { IntegrationValidationRunner, ValidationCall } from "@termbook/sdk";
import { parseAbi, zeroAddress, type Hex } from "viem";
import { DeploymentFixture } from "./deployment-fixture.js";
import { MARKET, USDC, signature, type Facility } from "./acceptance-fixture.js";

export const orderCases = ["forced_cancel", "asynchronous_failure", "pending_limit", "partial_fill_slots", "duplicate_claim"] as const;

export function orderScenarios(f: DeploymentFixture) {
  const orders = f.orderDefinition!;
  const reader = f.deployment.configuration["kuru-integration"].definition.contracts.reader;
  const margin = orders.rules[0]!.custody;
  const observe = (r: IntegrationValidationRunner, v: Facility, phase: "before" | "after") => r.observe({ id: `${phase}_pending`,
    target: f.addresses.FlowExecutor!, from: f.actors.borrower, signature: "function pendingCount(bytes32) view returns(uint256)", args: [v.id], phase });
  const assert = (r: IntegrationValidationRunner, label: string, observation: string, value: bigint) => r.assert({ label,
    left: { observation, index: 0 }, operator: "eq", right: { value: String(value) } });
  const pendingId = async (v: Facility) => f.chain.readContract({ address: orders.tracker as Hex,
    abi: parseAbi(["function details(bytes32,bytes32) view returns(bytes32,address,uint256)"]), functionName: "details",
    args: [v.id, await f.chain.readContract({ address: f.addresses.FlowExecutor!, abi: parseAbi(["function pendingAt(bytes32,uint256) view returns(bytes32)"]),
      functionName: "pendingAt", args: [v.id, 0n] })] }).then((value) => value[2]);
  const place = async (v: Facility, amount = 10_000n, draw = amount) => { await f.refresh(); await f.transact(await f.limitOrder(v, amount, draw)); return pendingId(v); };
  const fill = async (id: bigint, half: boolean) => {
    const order = await f.chain.readContract({ address: MARKET, abi: parseAbi([
      "function s_orders(uint40) view returns(address,uint96,uint40,uint40,uint40,uint32,uint32,bool)" ]), functionName: "s_orders", args: [Number(id)] });
    const quantity = half ? order[1] / 2n : order[1] + 1_000_000n;
    await f.transact({ to: MARKET, from: f.actors.unauthorized,
      signature: "function placeAndExecuteMarketSell(uint96,uint256,bool,bool) payable returns(uint256)",
      args: [quantity, 1n, false, true], value: quantity * 100_000_000n });
  };
  const defaulted = async (v: Facility) => {
    await f.creditField(v.id, "maturity", (await f.chain.getBlock()).timestamp);
    await f.call("TermbookCore", "markDefaulted", [v.id]); await f.call("TermbookCore", "startLiquidation", [v.id]); await f.refresh(f.bid - 1n);
  };
  const recovery = async (v: Facility): Promise<ValidationCall> => ({ to: f.addresses.TermbookCore!, from: f.actors.keeper,
    signature: await signature("TermbookCore", "recoverApp"), args: [v.id, (await f.read("AtomicSpotModule", "nextExitStep", [v.id, v.account]))[1]] });
  const cases: Partial<Record<AcceptanceCaseId, (r: IntegrationValidationRunner) => Promise<void>>> = {};
  for (const id of orderCases) cases[id] = async (r) => {
    const v = f.facilities.get(id)!;
    if (id === "pending_limit") {
      await f.transact({ to: USDC, from: f.actors.borrower, signature: "function transfer(address,uint256) returns(bool)", args: [v.account, 20_000n] });
      const count = f.deployment.configuration["kuru-integration"].definition.assessment!.max_pending;
      for (let n = 0; n < count; n++) await place(v, 1000n, 0n);
      await observe(r, v, "before"); await f.refresh();
      const control = f.facilities.get("control")!;
      const valid = await r.simulate("control", await f.limitOrder(control));
      if (valid.reverted) throw new Error("validation-order-limit-control-reverted");
      const rejected = await r.simulate("rejected", await f.limitOrder(v, 1000n, 0n), "control");
      if (!rejected.reverted) throw new Error("validation-order-limit-accepted");
      await observe(r, v, "after"); await assert(r, "Existing orders reach the admitted bound", "before_pending", BigInt(count));
      await assert(r, "Rejected order adds no pending item", "after_pending", BigInt(count)); return;
    }
    const venueId = await place(v); await observe(r, v, "before");
    if (id === "partial_fill_slots") {
      await fill(venueId, true); await f.refresh(f.bid - 1n);
      await r.observe({ id: "remaining", target: reader as Hex, from: f.actors.borrower,
        signature: "function pendingCount(bytes32,address) view returns(uint256)", args: [v.id, v.account], phase: "after" });
      const cancelled = await r.transact(await f.cancelOrder(v, venueId));
      if (!cancelled.succeeded) throw new Error("validation-partial-cancel-reverted");
      await r.observe({ id: "base_proceeds", target: margin as Hex, from: f.actors.borrower,
        signature: "function getBalance(address,address) view returns(uint256)", args: [v.account, zeroAddress], phase: "after" });
      await observe(r, v, "after"); await assert(r, "Resting order was tracked", "before_pending", 1n);
      await assert(r, "Partial fill retains one pending order", "remaining", 1n); await assert(r, "Cancellation frees its slot", "after_pending", 0n);
      await r.assert({ label: "Fill proceeds remain controlled", left: { observation: "base_proceeds", index: 0 }, operator: "gt", right: { value: "0" } }); return;
    }
    if (id === "duplicate_claim") {
      if (!(await r.transact(await f.cancelOrder(v, venueId))).succeeded) throw new Error("validation-cancel-reverted");
      const control = f.facilities.get("order_control")!, other = await place(control);
      const valid = await r.simulate("control", await f.cancelOrder(control, other));
      if (valid.reverted) throw new Error("validation-cancel-control-reverted");
      const duplicate = await r.simulate("duplicate", await f.cancelOrder(v, venueId), "control");
      if (!duplicate.reverted) throw new Error("validation-duplicate-refund-accepted");
      await observe(r, v, "after"); await assert(r, "One original pending order", "before_pending", 1n);
      await assert(r, "Refund cannot create a second cancellation", "after_pending", 0n); return;
    }
    await defaulted(v);
    if (id === "asynchronous_failure") {
      if (!(await r.transact(await recovery(v))).succeeded) throw new Error("validation-checkpoint-reverted");
      const stale = await recovery(v); await fill(venueId, true); await f.refresh(f.bid - 1n);
      const valid = await r.simulate("control", await recovery(v));
      if (valid.reverted) throw new Error("validation-checkpoint-refresh-reverted");
      const rejected = await r.simulate("stale_cancel", stale, "control");
      if (!rejected.reverted) throw new Error("validation-stale-cancel-accepted");
      if (!(await r.transact(await recovery(v))).succeeded || !(await r.transact(await recovery(v))).succeeded) throw new Error("validation-cancel-retry-reverted");
    } else {
      if (!(await r.transact(await recovery(v))).succeeded || !(await r.transact(await recovery(v))).succeeded) throw new Error("validation-forced-cancel-reverted");
      for (let step = 0; step < 6; step++) {
        const [next] = await f.read("AtomicSpotModule", "nextExitStep", [v.id, v.account]);
        if (/^0x0{64}$/.test(next)) break;
        if (!(await r.transact(await recovery(v))).succeeded) throw new Error("validation-custody-recovery-reverted");
      }
      await r.observe({ id: "venue_cash", target: margin as Hex, from: f.actors.borrower,
        signature: "function getBalance(address,address) view returns(uint256)", args: [v.account, USDC], phase: "after" });
      await assert(r, "Keeper withdraws the refunded venue cash", "venue_cash", 0n);
    }
    await observe(r, v, "after"); await assert(r, "One order before recovery", "before_pending", 1n);
    await assert(r, "Keeper cancels without the borrower", "after_pending", 0n);
  };
  return cases;
}
