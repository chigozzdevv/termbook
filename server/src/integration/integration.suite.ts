import { acceptanceCases, canonicalEvidence, integrationSuiteSchema,
  type AcceptanceCase, type CapabilityDefinition, type IntegrationSuite } from "@termbook/schema";
import { BaseError, decodeAbiParameters, decodeFunctionData, encodeFunctionData, keccak256, parseAbiItem,
  recoverTypedDataAddress, stringToHex, toFunctionSelector, type Hex, type PublicClient } from "viem";
import { env } from "../config/env.js";
import { authService } from "../auth/auth.service.js";

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export function suiteHash(suite: IntegrationSuite): Hex { return keccak256(stringToHex(canonicalEvidence(suite))); }
export function forkReviewData(suite: IntegrationSuite) {
  return { domain: { name: "Termbook Integration Review", version: "1", chainId: suite.chainId, verifyingContract: suite.core as Hex },
    primaryType: "ForkReview", types: { ForkReview: [{ name: "versionId", type: "bytes32" }, { name: "manifestHash", type: "bytes32" },
      { name: "evidenceHash", type: "bytes32" }, { name: "sourceBlockHash", type: "bytes32" }] },
    message: { versionId: suite.versionId as Hex, manifestHash: suite.manifestHash as Hex, evidenceHash: suiteHash(suite), sourceBlockHash: suite.sourceBlock.hash as Hex } } as const;
}
export function assertSuiteEnvelope(versionId: Hex, manifestHash: Hex, suiteInput: unknown, evidenceHash: string,
  actions: CapabilityDefinition[]): IntegrationSuite {
  const suite = integrationSuiteSchema.parse(suiteInput);
  if (!same(suite.versionId, versionId) || !same(suite.manifestHash, manifestHash)
    || !same(suite.core, env.core) || suite.chainId !== env.monadChainId || !same(suiteHash(suite), evidenceHash)) throw new Error("integration-suite-binding-invalid");
  const asynchronous = actions.some((action) => action.settlement === "asynchronous");
  const reducible = actions.some((action) => action.capability === "reduce_position");
  const allowedExclusions = new Set<string>([
    ...(!asynchronous ? ["forced_cancel", "asynchronous_failure", "pending_limit", "partial_fill_slots", "duplicate_claim"] : []),
    ...(!reducible ? ["forced_reduce"] : []), "retention_authorization",
  ]);
  if (suite.exclusions.some((item) => !allowedExclusions.has(item.id)) || !actions.length) throw new Error("integration-suite-exclusion-invalid");
  const covered = new Set(suite.cases.map((item) => acceptanceCases[item.id]));
  if (covered.size !== 16) throw new Error("integration-suite-requirement-missing");
  for (const item of suite.cases) assertCase(item, suite);
  return suite;
}
function assertCase(item: AcceptanceCase, suite: IntegrationSuite): void {
  const pinned = new Set(suite.contracts.map((pin) => pin.target.toLowerCase()));
  const observations = new Map(item.observations.map((observation) => [observation.id, observation]));
  for (const observation of item.observations) {
    const fn = parseAbiItem(observation.signature);
    if (!pinned.has(observation.target.toLowerCase()) || fn.type !== "function" || !["view", "pure"].includes(fn.stateMutability)
      || toFunctionSelector(fn).toLowerCase() !== observation.data.slice(0, 10).toLowerCase()
      || fn.outputs.map((param) => param.type).join(",") !== observation.types.join(",")
      || observation.result.length !== 2 + observation.types.length * 64) throw new Error("integration-observation-invalid");
    const decoded = decodeFunctionData({ abi: [fn], data: observation.data as Hex });
    if (encodeFunctionData({ abi: [fn], functionName: fn.name, args: decoded.args ?? [] } as never).toLowerCase() !== observation.data.toLowerCase()) throw new Error("integration-observation-invalid");
  }
  const operandValue = (operand: AcceptanceCase["assertions"][number]["left"]) => {
    if ("value" in operand) return operand.value;
    const observation = observations.get(operand.observation)!;
    return String(decodeAbiParameters(observation.types.map((type) => ({ type })), observation.result as Hex)[operand.index]);
  };
  for (const assertion of item.assertions) {
    const l = operandValue(assertion.left), r = operandValue(assertion.right);
    let passed: boolean;
    if (assertion.operator === "eq" || assertion.operator === "ne") passed = same(l, r) === (assertion.operator === "eq");
    else {
      if (!/^-?\d+$/.test(l) || !/^-?\d+$/.test(r)) throw new Error("integration-assertion-type-invalid");
      const left = BigInt(l), right = BigInt(r);
      passed = assertion.operator === "lt" ? left < right : assertion.operator === "le" ? left <= right : assertion.operator === "gt" ? left > right : left >= right;
    }
    if (!passed) throw new Error("integration-assertion-failed");
  }
  if ([...item.transactions, ...item.simulations].some((tx) => !pinned.has(tx.to.toLowerCase()) || tx.data.length < 10)) throw new Error("integration-call-evidence-invalid");
  if (item.transactions.some((tx) => BigInt(tx.gasUsed) > BigInt(tx.gasLimit))) throw new Error("integration-execution-budget-exceeded");
  if (item.simulations.some((simulation) => simulation.reverted && !item.simulations.some((control) => control.id === simulation.control
    && control.block.number === simulation.block.number && same(control.block.hash, simulation.block.hash)))) throw new Error("integration-failure-control-invalid");
  if (item.id === "unauthorized_module" && !item.simulations.some((simulation) => simulation.reverted && same(simulation.from, suite.actors.unauthorized))) {
    throw new Error("integration-role-evidence-invalid");
  }
  const before = item.observations.filter((v) => v.phase === "before").map((v) => BigInt(v.block.number));
  const after = item.observations.filter((v) => v.phase === "after").map((v) => BigInt(v.block.number));
  if (after.some((n) => before.some((b) => n < b)) || [...item.observations, ...item.transactions, ...item.simulations]
    .some((v) => BigInt(v.block.number) < BigInt(suite.sourceBlock.number))) throw new Error("integration-evidence-order-invalid");
}
export async function verifySuitePins(chain: PublicClient, suite: IntegrationSuite, blockNumber: bigint): Promise<void> {
  for (let offset = 0; offset < suite.contracts.length; offset += 8) await Promise.all(suite.contracts.slice(offset, offset + 8).map(async (pin) => {
    const code = await chain.getBytecode({ address: pin.target as Hex, blockNumber });
    if (!code || code === "0x" || !same(keccak256(code), pin.codeHash)) throw new Error("integration-suite-code-changed");
  }));
}
function revertData(error: unknown): Hex | undefined {
  const cause = error instanceof BaseError ? error.walk((cause) => typeof cause === "object" && cause !== null && "data" in cause && typeof cause.data === "string" && /^0x(?:[a-fA-F0-9]{2})*$/.test(cause.data)) : undefined;
  return cause && typeof cause === "object" && "data" in cause && typeof cause.data === "string" ? cause.data as Hex : undefined;
}
export async function validateIntegrationSuite(chain: PublicClient, versionId: Hex, manifestHash: Hex,
  input: unknown, evidenceHash: string, actions: CapabilityDefinition[]): Promise<IntegrationSuite> {
  const suite = assertSuiteEnvelope(versionId, manifestHash, input, evidenceHash, actions);
  const finalized = await chain.getBlock({ blockTag: "finalized" });
  if (await chain.getChainId() !== suite.chainId) throw new Error("integration-chain-mismatch");
  const block = await chain.getBlock({ blockNumber: BigInt(suite.sourceBlock.number) });
  if (block.number > finalized.number || !same(block.hash, suite.sourceBlock.hash)) throw new Error("integration-suite-source-invalid");
  const calls = suite.cases.reduce((n, c) => n + c.observations.length + c.transactions.length + c.simulations.length, suite.contracts.length);
  if (calls > 512) throw new Error("integration-evidence-budget-exceeded");
  await Promise.all([verifySuitePins(chain, suite, block.number), verifySuitePins(chain, suite, finalized.number)]);
  if (suite.mode === "fork") return suite;
  const gasBudget = BigInt(process.env["INTEGRATION_TEST_GAS_BUDGET"] ?? "16000000");
  if (gasBudget <= 0n || gasBudget > finalized.gasLimit) throw new Error("integration-gas-budget-invalid");
  const blocks = new Map<string, Promise<{ number: bigint; hash: Hex; transactions: readonly Hex[] }>>();
  const canonical = async (reference: { number: string; hash: string }) => {
    let request = blocks.get(reference.number);
    if (!request) {
      request = chain.getBlock({ blockNumber: BigInt(reference.number) }).then((found) => {
        if (found.number === null || found.hash === null || found.transactions.some((tx) => typeof tx !== "string")) throw new Error("integration-evidence-noncanonical");
        return { number: found.number, hash: found.hash, transactions: found.transactions as Hex[] };
      }); blocks.set(reference.number, request);
    }
    const found = await request;
    if (found.number > finalized.number || !same(found.hash, reference.hash)) throw new Error("integration-evidence-noncanonical");
    return found;
  };
  for (const item of suite.cases) {
    for (const observation of item.observations) {
      const found = await canonical(observation.block);
      const actual = await chain.call({ to: observation.target as Hex, account: observation.from as Hex,
        data: observation.data as Hex, blockNumber: found.number });
      if (!same(actual.data ?? "0x", observation.result)) throw new Error("integration-observation-mismatch");
    }
    for (const tx of item.transactions) {
      const [found, receipt, actual] = await Promise.all([canonical(tx.block), chain.getTransactionReceipt({ hash: tx.hash as Hex }), chain.getTransaction({ hash: tx.hash as Hex })]);
      if (!same(found.transactions[receipt.transactionIndex]!, tx.hash) || !same(receipt.blockHash, tx.block.hash)
        || receipt.blockNumber !== found.number || (receipt.status === "success") !== tx.succeeded || !actual.to || !same(actual.to, tx.to)
        || !same(actual.from, tx.from) || !same(actual.input, tx.data) || actual.value !== BigInt(tx.value)
        || receipt.gasUsed !== BigInt(tx.gasUsed) || BigInt(tx.gasLimit) > gasBudget) throw new Error("integration-transaction-evidence-mismatch");
    }
    for (const simulation of item.simulations) {
      const found = await canonical(simulation.block);
      let result: Hex, reverted = false;
      try { result = (await chain.call({ to: simulation.to as Hex, account: simulation.from as Hex,
        data: simulation.data as Hex, value: BigInt(simulation.value), blockNumber: found.number })).data ?? "0x"; }
      catch (error) { const data = revertData(error); if (data === undefined) throw error; result = data; reverted = true; }
      if (reverted !== simulation.reverted || !same(result, simulation.result)) throw new Error("integration-simulation-mismatch");
    }
  }
  return suite;
}
export async function requireForkReview(suite: IntegrationSuite, signature?: Hex, reviewer?: Hex): Promise<void> {
  if (suite.mode !== "fork") return;
  if (!signature || !reviewer || !authService.isAdmin(reviewer)) throw new Error("integration-fork-review-required");
  const recovered = await recoverTypedDataAddress({ ...forkReviewData(suite), signature });
  if (!same(recovered, reviewer)) throw new Error("integration-fork-review-invalid");
}
