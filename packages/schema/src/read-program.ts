import { z } from "zod";
import { addressSchema, bytes32Schema } from "./auth.js";

export const readProgramSchema = z.strictObject({
  queries: z.array(z.strictObject({ target: addressSchema, data: z.string().regex(/^0x[a-fA-F0-9]{8}(?:[a-fA-F0-9]{64}){0,32}$/),
    arguments: z.array(z.strictObject({ word: z.number().int().min(0).max(31), register: z.number().int().min(0).max(1023) })).max(32),
    expected_hash: bytes32Schema, gas_limit: z.number().int().min(1).max(500_000) })).max(16),
  steps: z.array(z.strictObject({ op: z.number().int().min(0).max(24), a: z.number().int().min(0).max(1023),
    b: z.number().int().min(0).max(1023), c: z.number().int().min(0).max(1023),
    value: z.string().regex(/^\d{1,78}$/).refine((value) => BigInt(value) < 2n ** 256n) })).min(1).max(1024),
  outputs: z.array(z.number().int().min(0).max(1023)).min(1).max(32),
}).superRefine((program, ctx) => {
  const invalid = () => ctx.addIssue({ code: "custom", message: "integration-read-program-invalid" });
  if (program.queries.reduce((sum, query) => sum + query.gas_limit, 0) > 1_000_000
    || program.outputs.some((index) => index >= program.steps.length)) invalid();
  for (const query of program.queries) if (new Set(query.arguments.map((arg) => arg.word)).size !== query.arguments.length
    || query.arguments.some((arg) => 4 + arg.word * 32 + 32 > (query.data.length - 2) / 2 || arg.register >= program.steps.length)) invalid();
  program.steps.forEach((step, index) => {
    if ([step.a, step.b, step.c].some((register) => register >= program.steps.length)) invalid();
    if ([6, 7, 8].includes(step.op)) {
      const query = program.queries[Number(step.value)];
      if (!query || step.op !== 8 && step.a >= index || query?.arguments.some((arg) => arg.register >= index)) invalid();
    } else if (step.op >= 9 && (step.a >= index || ![19, 21].includes(step.op) && step.b >= index
      || [11, 20].includes(step.op) && step.c >= index)) invalid();
  });
});
export type ReadProgramDefinition = z.infer<typeof readProgramSchema>;

export function queryDerived(program: ReadProgramDefinition, register: number): boolean {
  const seen = new Set<number>();
  const visit = (index: number): boolean => {
    if (seen.has(index)) return false;
    seen.add(index);
    const step = program.steps[index];
    if (!step) return false;
    if ([6, 7, 8].includes(step.op)) return true;
    if (step.op < 9) return false;
    return visit(step.a) || ![19, 21].includes(step.op) && visit(step.b) || [11, 20].includes(step.op) && visit(step.c);
  };
  return visit(register);
}
