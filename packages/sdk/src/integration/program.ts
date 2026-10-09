import type { EvidenceAssertion } from "@termbook/schema";
import { package_integration } from "./plugin.js";
import type { ValidationCall, ValidationRead } from "./validation.js";
import type { ValidationEnvironment, ValidationSession } from "./author.js";

export type ValidationStep =
  | { operation: "read"; read: ValidationRead }
  | { operation: "transact"; call: ValidationCall }
  | { operation: "simulate"; id: string; call: ValidationCall; control?: string }
  | { operation: "assert"; assertion: EvidenceAssertion };
export type ValidationProgram = Omit<ValidationSession, "cases"> & {
  cases: Partial<Record<keyof ValidationSession["cases"], ValidationStep[]>>;
};

export function create_validation_environment(input: Omit<ValidationEnvironment, "prepare"> & {
  prepare: (input: Parameters<ValidationEnvironment["prepare"]>[0]) => Promise<ValidationProgram>;
}): ValidationEnvironment {
  return { client: input.client, options: input.options, async prepare(request) {
    const identity = package_integration(request.plugin);
    if (identity.version_id !== request.version_id || identity.hash !== request.manifest_hash) throw new Error("integration-validation-binding-invalid");
    const program = await input.prepare(request);
    const cases: ValidationSession["cases"] = {};
    for (const [id, steps] of Object.entries(program.cases)) {
      if (!Array.isArray(steps) || steps.length === 0 || steps.length > 256) throw new Error("integration-program-invalid");
      cases[id as keyof typeof cases] = async (runner) => {
        for (const step of steps) {
          if (step.operation === "read") await runner.observe(step.read);
          else if (step.operation === "transact") await runner.transact(step.call);
          else if (step.operation === "simulate") await runner.simulate(step.id, step.call, step.control);
          else if (step.operation === "assert") await runner.assert(step.assertion);
          else throw new Error("integration-program-invalid");
        }
      };
    }
    return { ...program, cases };
  } };
}
