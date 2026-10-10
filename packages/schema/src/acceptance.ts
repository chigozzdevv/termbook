import { z } from "zod";
import { addressSchema, bytes32Schema } from "./auth.js";

export const acceptanceCases = {
  source_identity: 1, account_permissions: 2, bounded_calls: 3,
  replay: 4, reentrancy: 4, unauthorized_module: 4, ownership_escape: 4,
  portfolio_state: 5, pricing: 6, portfolio_valuation: 7,
  forced_cancel: 8, forced_reduce: 8, forced_close: 8, forced_settlement: 8,
  asynchronous_failure: 9, pause_failure: 9, stale_oracle: 9, permission_loss: 9, upgrade_failure: 9,
  debt_free_release: 10, recovery_isolation: 11, action_schemas: 12,
  financed_costs: 12, insufficient_limit: 12, slippage: 12,
  proceeds_return: 13, close_interruption: 13, duplicate_close: 13, failed_return: 13,
  zero_cash_close: 14, retention_authorization: 14, closing_risk_increase: 14,
  partial_cure: 15, maturity_cure: 15, default_cure: 15, pending_cure: 15, full_termination_cure: 15,
  portfolio_limit: 16, pending_limit: 16, partial_fill_slots: 16, duplicate_claim: 16,
  unsolicited_asset: 16, recovery_interruption: 16,
} as const;
export type AcceptanceCaseId = keyof typeof acceptanceCases;
export const rejectionCases: readonly AcceptanceCaseId[] = ["replay", "reentrancy", "unauthorized_module", "ownership_escape",
  "insufficient_limit", "slippage", "closing_risk_increase", "maturity_cure", "default_cure", "pending_cure",
  "full_termination_cure", "portfolio_limit", "pending_limit"];
const hex = z.string().regex(/^0x(?:[a-fA-F0-9]{2})*$/).max(32_770);
const integer = z.string().regex(/^\d{1,78}$/);
export const evidenceBlockSchema = z.strictObject({ number: integer, hash: bytes32Schema });
const scalar = z.string().regex(/^(address|bool|bytes(?:4|32)|u?int(?:8|16|32|64|128|256))$/);
export const evidenceObservationSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), target: addressSchema, from: addressSchema,
  signature: z.string().min(10).max(512), data: hex, result: hex, block: evidenceBlockSchema,
  types: z.array(scalar).min(1).max(32), phase: z.enum(["before", "after"]),
});
export const evidenceTransactionSchema = z.strictObject({
  hash: bytes32Schema, from: addressSchema, to: addressSchema, data: hex, value: integer,
  succeeded: z.boolean(), block: evidenceBlockSchema, gasUsed: integer, gasLimit: integer,
});
export const evidenceSimulationSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), from: addressSchema, to: addressSchema,
  data: hex, value: integer, block: evidenceBlockSchema, reverted: z.boolean(), result: hex,
  control: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/).optional(),
});
const operand = z.union([
  z.strictObject({ observation: z.string().min(1).max(64), index: z.number().int().min(0).max(31) }),
  z.strictObject({ value: z.string().max(80) }),
]);
export const evidenceAssertionSchema = z.strictObject({
  label: z.string().min(1).max(160), left: operand,
  operator: z.enum(["eq", "ne", "lt", "le", "gt", "ge"]), right: operand,
});
export const acceptanceCaseSchema = z.strictObject({
  id: z.enum(Object.keys(acceptanceCases) as [AcceptanceCaseId, ...AcceptanceCaseId[]]),
  observations: z.array(evidenceObservationSchema).min(2).max(64),
  transactions: z.array(evidenceTransactionSchema).max(64), simulations: z.array(evidenceSimulationSchema).max(32),
  assertions: z.array(evidenceAssertionSchema).min(1).max(64),
});
export const integrationSuiteSchema = z.strictObject({
  format: z.literal(1), versionId: bytes32Schema, manifestHash: bytes32Schema, core: addressSchema,
  chainId: z.number().int().positive(), mode: z.enum(["deployment", "fork"]),
  sourceBlock: evidenceBlockSchema, forkRpcIdentity: bytes32Schema.optional(),
  actors: z.strictObject({ borrower: addressSchema, keeper: addressSchema, unauthorized: addressSchema }),
  contracts: z.array(z.strictObject({ target: addressSchema, codeHash: bytes32Schema, fixture: z.literal(true).optional() })).min(1).max(128),
  cases: z.array(acceptanceCaseSchema).min(1).max(Object.keys(acceptanceCases).length),
  exclusions: z.array(z.strictObject({ id: z.enum(Object.keys(acceptanceCases) as [AcceptanceCaseId, ...AcceptanceCaseId[]]),
    reason: z.string().min(20).max(1000) })).max(16),
}).superRefine((report, ctx) => {
  const actors = Object.values(report.actors).map((a) => a.toLowerCase());
  const targets = report.contracts.map((item) => item.target.toLowerCase());
  const cases = [...report.cases.map((item) => item.id), ...report.exclusions.map((item) => item.id)];
  if (new Set(actors).size !== actors.length || new Set(targets).size !== targets.length
    || new Set(cases).size !== cases.length || cases.length !== Object.keys(acceptanceCases).length
    || report.mode === "fork" && !report.forkRpcIdentity || report.mode === "deployment" && report.forkRpcIdentity) {
    ctx.addIssue({ code: "custom", message: "integration-suite-incomplete" });
  }
  if (!targets.includes(report.core.toLowerCase())) ctx.addIssue({ code: "custom", message: "integration-core-pin-required" });
  if (report.contracts.some((pin) => pin.fixture && (report.mode !== "fork" || pin.target.toLowerCase() === report.core.toLowerCase()))) {
    ctx.addIssue({ code: "custom", message: "integration-fixture-pin-invalid" });
  }
  for (const item of report.cases) {
    const ids = item.observations.map((observation) => observation.id);
    if (new Set(ids).size !== ids.length || !item.observations.some((v) => v.phase === "before")
      || !item.observations.some((v) => v.phase === "after") || item.transactions.length + item.simulations.length === 0) {
      ctx.addIssue({ code: "custom", message: "integration-case-evidence-incomplete" });
    }
    for (const assertion of item.assertions) for (const operand of [assertion.left, assertion.right]) {
      if ("observation" in operand && !item.observations.some((v) => v.id === operand.observation && operand.index < v.types.length)) {
        ctx.addIssue({ code: "custom", message: "integration-assertion-reference-invalid" });
      }
    }
    const asserted = item.assertions.flatMap((assertion) => [assertion.left, assertion.right])
      .flatMap((operand) => "observation" in operand ? [operand.observation] : []);
    if (!["before", "after"].every((phase) => item.observations.some((v) => v.phase === phase && asserted.includes(v.id)))) {
      ctx.addIssue({ code: "custom", message: "integration-state-assertions-required" });
    }
    if (rejectionCases.includes(item.id) && !item.simulations.some((v) => v.reverted)) {
      ctx.addIssue({ code: "custom", message: "integration-rejection-evidence-required" });
    }
    const simulations = item.simulations.map((simulation) => simulation.id);
    if (new Set(simulations).size !== simulations.length || item.simulations.some((v) => v.reverted && (!v.control
      || !item.simulations.some((control) => control.id === v.control && !control.reverted
        && control.to.toLowerCase() === v.to.toLowerCase() && control.data.slice(0, 10) === v.data.slice(0, 10))))) {
      ctx.addIssue({ code: "custom", message: "integration-failure-control-required" });
    }
  }
});
export type IntegrationSuite = z.infer<typeof integrationSuiteSchema>;
export type AcceptanceCase = z.infer<typeof acceptanceCaseSchema>;
export type EvidenceObservation = z.infer<typeof evidenceObservationSchema>;
export type EvidenceTransaction = z.infer<typeof evidenceTransactionSchema>;
export type EvidenceSimulation = z.infer<typeof evidenceSimulationSchema>;
export type EvidenceAssertion = z.infer<typeof evidenceAssertionSchema>;
export const integrationSuiteContextSchema = z.strictObject({
  format: integrationSuiteSchema.shape.format, versionId: integrationSuiteSchema.shape.versionId,
  manifestHash: integrationSuiteSchema.shape.manifestHash, core: integrationSuiteSchema.shape.core,
  chainId: integrationSuiteSchema.shape.chainId, mode: integrationSuiteSchema.shape.mode,
  sourceBlock: integrationSuiteSchema.shape.sourceBlock, forkRpcIdentity: integrationSuiteSchema.shape.forkRpcIdentity,
  actors: integrationSuiteSchema.shape.actors, contracts: integrationSuiteSchema.shape.contracts,
}).refine((context) => {
  const actors = Object.values(context.actors).map((a) => a.toLowerCase());
  const targets = context.contracts.map((c) => c.target.toLowerCase());
  return new Set(actors).size === 3 && actors.every((a) => !/^0x0{40}$/i.test(a))
    && new Set(targets).size === targets.length && targets.includes(context.core.toLowerCase())
    && !context.contracts.some((pin) => pin.fixture && (context.mode !== "fork" || pin.target.toLowerCase() === context.core.toLowerCase()))
    && (context.mode === "fork" ? !!context.forkRpcIdentity : !context.forkRpcIdentity);
}, "integration-context-invalid");
export function canonicalEvidence(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalEvidence).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalEvidence(record[key])}`).join(",")}}`;
}
