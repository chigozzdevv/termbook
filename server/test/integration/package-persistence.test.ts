import { describe, expect, it } from "vitest";
import { canonicalEvidence, pluginDefinitionSchema } from "@termbook/schema";
import { standardDefinition } from "../../../packages/sdk/test/use-case.fixture.js";
import { PackageModel } from "../../src/integration/package.model.js";
import { IntegrationModel } from "../../src/integration/integration.model.js";

describe("integration definition persistence", () => {
  it("preserves empty assessment maps in validation and active integration documents", () => {
    const definition = standardDefinition();
    definition.assessment!.reads = {};
    const original = pluginDefinitionSchema.parse(definition);
    for (const [Model, field] of [[PackageModel, "definition"], [IntegrationModel, "packageDefinition"]] as const) {
      const saved = new Model({ [field]: original }).toObject();
      const restored = pluginDefinitionSchema.parse(saved[field]);
      expect(restored.assessment!.reads).toEqual({});
      expect(canonicalEvidence(restored)).toBe(canonicalEvidence(original));
    }
  });
});
