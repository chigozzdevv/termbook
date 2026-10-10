import { acceptanceCases, acceptanceCaseSchema, canonicalEvidence, integrationSuiteSchema, integrationSuiteContextSchema,
  type AcceptanceCase, type AcceptanceCaseId, type EvidenceAssertion, type EvidenceObservation,
  type EvidenceSimulation, type EvidenceTransaction, type IntegrationSuite } from "@termbook/schema";
import { BaseError, decodeAbiParameters, decodeFunctionData, encodeFunctionData, keccak256, parseAbiItem, stringToHex,
  type Address, type Hex, type PublicClient, type TransactionReceipt } from "viem";
import type { Wallet } from "../types/client.types.js";

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export function integrationEvidenceHash(suite: IntegrationSuite): Hex {
  return keccak256(stringToHex(canonicalEvidence(integrationSuiteSchema.parse(suite))));
}
export function integrationForkReview(suite: IntegrationSuite) {
  return { domain: { name: "Termbook Integration Review", version: "1", chainId: suite.chainId, verifyingContract: suite.core as Address },
    primaryType: "ForkReview", types: { ForkReview: [{ name: "versionId", type: "bytes32" }, { name: "manifestHash", type: "bytes32" },
      { name: "evidenceHash", type: "bytes32" }, { name: "sourceBlockHash", type: "bytes32" }] },
    message: { versionId: suite.versionId as Hex, manifestHash: suite.manifestHash as Hex,
      evidenceHash: integrationEvidenceHash(suite), sourceBlockHash: suite.sourceBlock.hash as Hex } } as const;
}
export function assertIntegrationEvidence(item: AcceptanceCase): void {
  const observations = new Map(item.observations.map((observation) => [observation.id, observation]));
  const value = (operand: EvidenceAssertion["left"]): string => {
    if ("value" in operand) return operand.value;
    const observation = observations.get(operand.observation);
    if (!observation || operand.index >= observation.types.length) throw new Error("integration-assertion-reference-invalid");
    const values = decodeAbiParameters(observation.types.map((type) => ({ type })), observation.result as Hex);
    return String(values[operand.index]);
  };
  for (const assertion of item.assertions) {
    const left = value(assertion.left), right = value(assertion.right);
    let passed: boolean;
    if (assertion.operator === "eq" || assertion.operator === "ne") passed = same(left, right) === (assertion.operator === "eq");
    else {
      if (!/^-?\d+$/.test(left) || !/^-?\d+$/.test(right)) throw new Error("integration-assertion-type-invalid");
      const l = BigInt(left), r = BigInt(right);
      passed = assertion.operator === "lt" ? l < r : assertion.operator === "le" ? l <= r : assertion.operator === "gt" ? l > r : l >= r;
    }
    if (!passed) throw new Error(`integration-assertion-failed:${item.id}:${assertion.label}`);
  }
}
function revertData(error: unknown): Hex | undefined {
  const found = error instanceof BaseError ? error.walk((cause) => typeof cause === "object" && cause !== null && "data" in cause && typeof cause.data === "string" && /^0x(?:[a-fA-F0-9]{2})*$/.test(cause.data)) : undefined;
  return found && typeof found === "object" && "data" in found && typeof found.data === "string" ? found.data as Hex : undefined;
}
export type ValidationRead = {
  id: string; target: Address; signature: string; args?: readonly unknown[]; from: Address; phase: "before" | "after";
};
export type ValidationCall = { to: Address; signature: string; args?: readonly unknown[]; from: Address; value?: bigint };
export type ValidationCheckpoint = {
  suite: Omit<IntegrationSuite, "cases" | "exclusions">; cases: AcceptanceCase[];
  current?: AcceptanceCase;
  pending?: { caseId: AcceptanceCaseId; tx: Hex; from: Address; to: Address; data: Hex; value: string; gasLimit: string };
};
export class IntegrationValidationPendingError extends Error {
  constructor(readonly checkpoint: ValidationCheckpoint, cause?: unknown) { super("integration-validation-pending", { cause }); }
}
export type IntegrationValidationOptions = {
  gasLimit: bigint; timeoutMs?: number; pollIntervalMs?: number; signal?: AbortSignal;
  checkpoint?: ValidationCheckpoint; onProgress?: (checkpoint: ValidationCheckpoint) => void | Promise<void>;
};
export class IntegrationValidationRunner {
  private checkpoint: ValidationCheckpoint;
  private current?: AcceptanceCase;
  private until: number;
  private readonly interval: number;
  private transactionIndex = 0;
  private pinsVerified = false;
  constructor(readonly chain: PublicClient, suite: ValidationCheckpoint["suite"], readonly wallets: Wallet[], readonly options: IntegrationValidationOptions) {
    integrationSuiteContextSchema.parse(suite);
    this.checkpoint = options.checkpoint ? structuredClone(options.checkpoint) : { suite, cases: [] };
    if (canonicalEvidence(this.checkpoint.suite) !== canonicalEvidence(suite) || options.gasLimit <= 0n) throw new Error("integration-validation-checkpoint-invalid");
    const timeout = options.timeoutMs ?? 30 * 60_000;
    this.interval = options.pollIntervalMs ?? 1000;
    if (!Number.isSafeInteger(timeout) || timeout <= 0 || !Number.isSafeInteger(this.interval) || this.interval <= 0) throw new Error("param-invalid");
    this.until = Date.now() + timeout;
  }
  private interrupted() {
    if (this.options.signal?.aborted || Date.now() >= this.until) throw new IntegrationValidationPendingError(this.checkpoint);
  }
  private async persist() { await this.options.onProgress?.(structuredClone(this.checkpoint)); }
  private allowed(target: Address) {
    if (!this.checkpoint.suite.contracts.some((pin) => same(pin.target, target))) throw new Error("integration-target-unpinned");
  }
  private async finalizedReceipt(hash: Hex): Promise<TransactionReceipt> {
    for (;;) {
      this.interrupted();
      const receipt = await this.chain.getTransactionReceipt({ hash }).catch(() => undefined);
      const finalized = await this.chain.getBlock({ blockTag: "finalized" });
      if (receipt && receipt.blockNumber <= finalized.number) {
        const block = await this.chain.getBlock({ blockNumber: receipt.blockNumber });
        if (!same(block.hash, receipt.blockHash) || !same(block.transactions[receipt.transactionIndex]!, hash)) throw new Error("integration-transaction-noncanonical");
        return receipt;
      }
      await new Promise<void>((resolve) => {
        const done = () => { clearTimeout(timer); this.options.signal?.removeEventListener("abort", done); resolve(); };
        const timer = setTimeout(done, this.interval); this.options.signal?.addEventListener("abort", done, { once: true });
      });
    }
  }
  async verifyPins(): Promise<void> {
    if (await this.chain.getChainId() !== this.checkpoint.suite.chainId) throw new Error("integration-chain-mismatch");
    const block = await this.chain.getBlock({ blockNumber: BigInt(this.checkpoint.suite.sourceBlock.number) });
    const finalized = await this.chain.getBlock({ blockTag: "finalized" });
    if (block.number > finalized.number || !same(block.hash, this.checkpoint.suite.sourceBlock.hash) || this.options.gasLimit > finalized.gasLimit) throw new Error("integration-source-block-invalid");
    for (const pin of this.checkpoint.suite.contracts) {
      const code = await this.chain.getBytecode({ address: pin.target as Address, blockNumber: pin.fixture ? finalized.number : block.number });
      if (!code || code === "0x" || !same(keccak256(code), pin.codeHash)) throw new Error("integration-code-pin-invalid");
    }
  }
  async run(id: AcceptanceCaseId, scenario: (runner: IntegrationValidationRunner) => Promise<void>): Promise<void> {
    this.interrupted();
    if (!(id in acceptanceCases) || this.current || this.checkpoint.pending && this.checkpoint.pending.caseId !== id) throw new Error("integration-case-invalid");
    if (this.checkpoint.cases.some((item) => item.id === id)) return;
    if (!this.pinsVerified) { await this.verifyPins(); this.pinsVerified = true; }
    if (this.checkpoint.current && this.checkpoint.current.id !== id) throw new Error("integration-case-already-pending");
    this.current = this.checkpoint.current ?? { id, observations: [], transactions: [], simulations: [], assertions: [] };
    this.checkpoint.current = this.current; this.transactionIndex = 0;
    try {
      await scenario(this);
      assertIntegrationEvidence(this.current);
      this.checkpoint.cases.push(this.current); this.checkpoint.current = undefined;
      await this.persist();
    } catch (error) {
      throw error instanceof IntegrationValidationPendingError ? error : new IntegrationValidationPendingError(this.checkpoint, error);
    } finally { this.current = undefined; }
  }
  async observe(request: ValidationRead): Promise<EvidenceObservation> {
    this.interrupted(); this.allowed(request.target);
    if (!this.current) throw new Error("integration-case-invalid");
    const item = parseAbiItem(request.signature);
    if (item.type !== "function" || !["view", "pure"].includes(item.stateMutability) || item.outputs.length === 0) throw new Error("integration-state-read-invalid");
    const data = encodeFunctionData({ abi: [item], functionName: item.name, args: request.args ?? [] } as never);
    const existing = this.current.observations.find((v) => v.id === request.id);
    if (existing) {
      if (!same(existing.target, request.target) || !same(existing.from, request.from) || existing.data !== data
        || existing.signature !== request.signature || existing.phase !== request.phase) throw new Error("integration-state-read-conflict");
      return existing;
    }
    if (this.current.observations.length >= 64) throw new Error("integration-case-budget-exceeded");
    const block = await this.chain.getBlock({ blockTag: "finalized" });
    const result = await this.chain.call({ to: request.target, data, account: request.from, blockNumber: block.number });
    const observation: EvidenceObservation = { id: request.id, target: request.target, from: request.from, signature: request.signature,
      data, result: result.data ?? "0x", block: { number: String(block.number), hash: block.hash }, types: item.outputs.map((v) => v.type), phase: request.phase };
    if (observation.result.length !== 2 + observation.types.length * 64) throw new Error("integration-state-shape-invalid");
    this.current.observations.push(observation); await this.persist();
    return observation;
  }
  async simulate(id: string, request: ValidationCall, control?: string): Promise<EvidenceSimulation> {
    this.interrupted(); this.allowed(request.to);
    if (!this.current) throw new Error("integration-case-invalid");
    const item = parseAbiItem(request.signature);
    if (item.type !== "function") throw new Error("integration-call-invalid");
    const data = encodeFunctionData({ abi: [item], functionName: item.name, args: request.args ?? [] } as never);
    const existing = this.current.simulations.find((v) => v.id === id);
    if (existing) {
      if (!same(existing.to, request.to) || !same(existing.from, request.from) || existing.data !== data
        || existing.value !== String(request.value ?? 0n) || existing.control !== control) throw new Error("integration-simulation-conflict");
      return existing;
    }
    if (this.current.simulations.length >= 32) throw new Error("integration-case-budget-exceeded");
    const reference = control ? this.current.simulations.find((v) => v.id === control) : undefined;
    if (control && (!reference || reference.reverted || !same(reference.to, request.to)
      || reference.data.slice(0, 10) !== data.slice(0, 10))) throw new Error("integration-failure-control-invalid");
    const block = reference ? await this.chain.getBlock({ blockNumber: BigInt(reference.block.number) })
      : await this.chain.getBlock({ blockTag: "finalized" });
    if (reference && !same(block.hash, reference.block.hash)) throw new Error("integration-simulation-noncanonical");
    let result: Hex, reverted = false;
    try { result = (await this.chain.call({ to: request.to, account: request.from, data, value: request.value ?? 0n, blockNumber: block.number })).data ?? "0x"; }
    catch (error) { const reason = revertData(error); if (reason === undefined) throw error; result = reason; reverted = true; }
    const recorded: EvidenceSimulation = { id, from: request.from, to: request.to, data, value: String(request.value ?? 0n),
      block: { number: String(block.number), hash: block.hash }, reverted, result, control };
    this.current.simulations.push(recorded); await this.persist(); return recorded;
  }
  async replay(input: AcceptanceCase): Promise<void> {
    this.interrupted();
    const item = acceptanceCaseSchema.parse(input);
    if (!this.current || this.current.id !== item.id || this.current.observations.length || this.current.transactions.length
      || this.current.simulations.length || this.current.assertions.length) throw new Error("integration-replay-conflict");
    const finalized = await this.chain.getBlock({ blockTag: "finalized" });
    const canonical = async (reference: { number: string; hash: string }) => {
      this.interrupted();
      const block = await this.chain.getBlock({ blockNumber: BigInt(reference.number) });
      if (block.number < BigInt(this.checkpoint.suite.sourceBlock.number) || block.number > finalized.number
        || !same(block.hash, reference.hash)) throw new Error("integration-evidence-noncanonical");
      return block;
    };
    for (const observation of item.observations) {
      this.allowed(observation.target as Address);
      const fn = parseAbiItem(observation.signature);
      if (fn.type !== "function" || !["view", "pure"].includes(fn.stateMutability)
        || fn.outputs.map((output) => output.type).join(",") !== observation.types.join(",")) throw new Error("integration-state-read-invalid");
      const decoded = decodeFunctionData({ abi: [fn], data: observation.data as Hex });
      if (!same(encodeFunctionData({ abi: [fn], functionName: fn.name, args: decoded.args ?? [] } as never), observation.data)
        || observation.result.length !== 2 + fn.outputs.length * 64) throw new Error("integration-state-read-invalid");
      const block = await canonical(observation.block);
      const actual = await this.chain.call({ to: observation.target as Address, account: observation.from as Address,
        data: observation.data as Hex, blockNumber: block.number });
      if (!same(actual.data ?? "0x", observation.result)) throw new Error("integration-observation-mismatch");
    }
    for (const tx of item.transactions) {
      this.allowed(tx.to as Address);
      const [block, actual, receipt] = await Promise.all([canonical(tx.block),
        this.chain.getTransaction({ hash: tx.hash as Hex }), this.chain.getTransactionReceipt({ hash: tx.hash as Hex })]);
      if (!same(String(block.transactions[receipt.transactionIndex]), tx.hash) || !same(receipt.blockHash, block.hash)
        || receipt.blockNumber !== block.number || !actual.to || !same(actual.to, tx.to) || !same(actual.from, tx.from)
        || !same(actual.input, tx.data) || actual.value !== BigInt(tx.value) || (receipt.status === "success") !== tx.succeeded
        || receipt.gasUsed !== BigInt(tx.gasUsed) || receipt.gasUsed > BigInt(tx.gasLimit)
        || actual.gas !== BigInt(tx.gasLimit) || actual.gas > this.options.gasLimit) throw new Error("integration-transaction-evidence-mismatch");
    }
    for (const simulation of item.simulations) {
      this.allowed(simulation.to as Address);
      const block = await canonical(simulation.block);
      let result: Hex, reverted = false;
      try { result = (await this.chain.call({ to: simulation.to as Address, account: simulation.from as Address,
        data: simulation.data as Hex, value: BigInt(simulation.value), blockNumber: block.number })).data ?? "0x"; }
      catch (error) { const reason = revertData(error); if (reason === undefined) throw error; result = reason; reverted = true; }
      if (reverted !== simulation.reverted || !same(result, simulation.result)) throw new Error("integration-simulation-mismatch");
    }
    assertIntegrationEvidence(item);
    Object.assign(this.current, item);
    await this.persist();
  }
  async transact(request: ValidationCall): Promise<EvidenceTransaction> {
    this.interrupted(); this.allowed(request.to);
    if (!this.current) throw new Error("integration-case-invalid");
    const item = parseAbiItem(request.signature);
    const wallet = this.wallets.find((wallet) => same(wallet.address, request.from));
    if (item.type !== "function" || !wallet?.writeContract || wallet.getChainId && await wallet.getChainId() !== this.checkpoint.suite.chainId) throw new Error("integration-wallet-required");
    const data = encodeFunctionData({ abi: [item], functionName: item.name, args: request.args ?? [] } as never);
    const existing = this.current.transactions[this.transactionIndex++];
    if (existing) {
      if (!same(existing.to, request.to) || !same(existing.from, request.from) || existing.data !== data
        || existing.value !== String(request.value ?? 0n)) throw new Error("integration-transaction-conflict");
      return existing;
    }
    if (this.current.transactions.length >= 64) throw new Error("integration-case-budget-exceeded");
    const pending = this.checkpoint.pending;
    if (pending && (pending.caseId !== this.current.id || !same(pending.from, request.from) || !same(pending.to, request.to)
      || pending.data !== data || pending.value !== String(request.value ?? 0n))) throw new Error("integration-transaction-already-pending");
    const hash = pending?.tx ?? await wallet.writeContract({ address: request.to, abi: [item], functionName: item.name,
      args: request.args ?? [], value: request.value, account: request.from, gas: this.options.gasLimit });
    this.checkpoint.pending = { caseId: this.current.id, tx: hash, from: request.from, to: request.to, data,
      value: String(request.value ?? 0n), gasLimit: String(this.options.gasLimit) };
    await this.persist();
    const receipt = await this.finalizedReceipt(hash), tx = await this.chain.getTransaction({ hash });
    if (!tx.to || !same(tx.to, request.to) || !same(tx.from, request.from) || tx.input !== data || tx.value !== (request.value ?? 0n)) throw new Error("integration-transaction-binding-invalid");
    if (receipt.gasUsed > this.options.gasLimit) throw new Error("integration-execution-budget-exceeded");
    const recorded: EvidenceTransaction = { hash, from: request.from, to: request.to, data, value: String(tx.value),
      succeeded: receipt.status === "success", block: { number: String(receipt.blockNumber), hash: receipt.blockHash },
      gasUsed: String(receipt.gasUsed), gasLimit: String(this.options.gasLimit) };
    this.current.transactions.push(recorded); this.checkpoint.pending = undefined; await this.persist(); return recorded;
  }
  async assert(assertion: EvidenceAssertion): Promise<void> {
    if (!this.current || this.current.assertions.length >= 64) throw new Error("integration-case-budget-exceeded");
    const existing = this.current.assertions.find((item) => item.label === assertion.label);
    if (existing && canonicalEvidence(existing) !== canonicalEvidence(assertion)) throw new Error("integration-assertion-conflict");
    if (!existing) this.current.assertions.push(assertion);
    assertIntegrationEvidence(this.current); await this.persist();
  }
  finish(exclusions: IntegrationSuite["exclusions"] = []): { suite: IntegrationSuite; evidenceHash: Hex } {
    if (this.current || this.checkpoint.current || this.checkpoint.pending) throw new Error("integration-validation-pending");
    const suite = integrationSuiteSchema.parse({ ...this.checkpoint.suite, cases: this.checkpoint.cases, exclusions });
    suite.cases.forEach(assertIntegrationEvidence);
    return { suite, evidenceHash: integrationEvidenceHash(suite) };
  }
}
