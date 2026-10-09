import { z } from "zod";
import { addressSchema, bytes32Schema } from "./auth.js";
import { readProgramSchema, queryDerived } from "./read-program.js";

const address = addressSchema.refine((v) => !/^0x0{40}$/i.test(v));
const word = bytes32Schema.refine((v) => !/^0x0{64}$/i.test(v));
const uint = z.string().regex(/^\d{1,78}$/).refine((v) => BigInt(v) < 2n ** 256n);
const uint128 = uint.refine((v) => BigInt(v) < 2n ** 128n);
const program = (outputs: number) => readProgramSchema.refine((p) => p.outputs.length === outputs && p.queries.length > 0
  && (outputs === 2 ? queryDerived(p, p.outputs[1]!) : queryDerived(p, p.outputs[0]!)
    || p.queries.some((q) => q.arguments.some((arg) => [1, 2].includes(p.steps[arg.register]?.op ?? -1)))),
  "integration-read-shape-invalid");
export const assessmentAssetSchema = z.strictObject({
  token: addressSchema, oracle: address, feed_id: word, decimals: z.number().int().min(0).max(36),
  maximum: uint128.refine((v) => BigInt(v) > 0n), dust: uint128,
  quote: z.strictObject({ target: address, program: program(2) }).optional(),
}).refine((a) => BigInt(a.dust) < BigInt(a.maximum), "integration-asset-limit-invalid");
const constraint = z.strictObject({ kind: z.enum(["exact", "account", "range", "spend"]),
  exact: bytes32Schema, minimum: uint, maximum: uint,
}).refine((w) => BigInt(w.minimum) <= BigInt(w.maximum)
  && (w.kind === "exact" ? w.minimum === "0" && w.maximum === "0"
    : w.kind === "account" ? /^0x0{64}$/i.test(w.exact) && w.minimum === "0" && w.maximum === "0"
      : /^0x0{64}$/i.test(w.exact)), "integration-call-constraint-invalid");
export const assessmentSchema = z.strictObject({
  read_program: address, state_target: addressSchema,
  reads: z.strictObject({ meta: program(5).optional(), position: program(16).optional(),
    pending: program(14).optional(), reconcile: program(14).optional(), request: program(9).optional() }),
  assets: z.array(assessmentAssetSchema).max(16),
  markets: z.array(z.strictObject({ market_id: z.string().min(1).max(128), receipt: addressSchema,
    asset0: assessmentAssetSchema, asset1: assessmentAssetSchema.optional(), maximum_exposure: uint128.refine((v) => BigInt(v) > 0n) })).max(16),
  retained_bps: z.number().int().min(1).max(10000), recovery_costs: uint128,
  max_positions: z.number().int().min(1).max(32), max_pending: z.number().int().min(0).max(32), max_requests: z.number().int().min(0).max(32),
  action_limits: z.array(z.strictObject({ action: z.string().min(1).max(128), maximum_input: uint128, maximum_exposure: uint128 })).min(1).max(32),
  calls: z.array(z.strictObject({ target: address, selector: z.string().regex(/^0x[a-fA-F0-9]{8}$/), recovery: z.boolean(),
    native_maximum: uint, native_word: z.number().int().min(0).max(23).optional(), words: z.array(constraint).max(24) })).min(1).max(64),
  recovery: z.array(z.strictObject({ phase: z.enum(["pending", "request", "position", "holding"]), market_id: z.string().max(128),
    target: address, selector: z.string().regex(/^0x[a-fA-F0-9]{8}$/),
    words: z.array(z.strictObject({ source: z.enum(["literal", "account", "credit", "field", "minimum"]), value: bytes32Schema })).max(24),
    input: addressSchema, output: addressSchema, spend_field: z.number().int().min(0).max(15).optional(),
    minimum_field: z.number().int().min(0).max(15).optional(), asynchronous: z.boolean() })).min(1).max(64),
  prices: z.array(z.strictObject({ action: z.string().min(1).max(128), market_id: z.string().min(1).max(128), oracle: address,
    feed_id: word, target: address, selector: z.string().regex(/^0x[a-fA-F0-9]{8}$/), call_index: z.number().int().min(0).max(7),
    price_decimals: z.number().int().min(0).max(36), price_word: z.number().int().min(0).max(511),
    direction_word: z.number().int().min(0).max(511), maximum_direction: uint, minimum_direction: uint,
    max_slippage_bps: z.number().int().min(0).max(5000), max_deviation_bps: z.number().int().min(1).max(5000),
    max_authorization_age: z.number().int().min(1).max(900),
    amount: z.strictObject({ word: z.number().int().min(0).max(511), input_decimals: z.number().int().min(0).max(36),
      output_decimals: z.number().int().min(0).max(36), inverse: z.boolean(), max_input: z.boolean(), input: addressSchema, output: addressSchema }).optional(),
  })).max(64),
}).superRefine((v, ctx) => {
  const issue = () => ctx.addIssue({ code: "custom", message: "integration-assessment-invalid" });
  for (const values of [v.action_limits.map((a) => a.action), v.calls.map((c) => `${c.target}:${c.selector}`.toLowerCase()),
    v.markets.map((m) => m.market_id), v.assets.map((a) => a.token.toLowerCase()), v.recovery.map((r) => `${r.phase}:${r.market_id}`),
    v.prices.map((p) => `${p.action}:${p.market_id}`)]) if (new Set(values).size !== values.length) issue();
  if (v.assets.some((a) => !a.quote)) issue();
  if (v.max_requests > v.max_pending || (v.reads.pending || v.reads.request) && !v.reads.reconcile
    || (v.reads.position || v.reads.pending || v.reads.request) && !v.reads.meta) issue();
  for (const call of v.calls) if (BigInt(call.native_maximum) > 0n && (call.native_word === undefined
    || call.native_word >= call.words.length || call.words[call.native_word]?.kind !== "range")) issue();
  for (const rule of v.recovery) {
    if (rule.words.some((w) => w.source === "field" && BigInt(w.value) > 15n)
      || !v.calls.some((c) => c.recovery && c.target.toLowerCase() === rule.target.toLowerCase()
        && c.selector.toLowerCase() === rule.selector.toLowerCase() && c.words.length === rule.words.length)) issue();
  }
});
export type Assessment = z.infer<typeof assessmentSchema>;
