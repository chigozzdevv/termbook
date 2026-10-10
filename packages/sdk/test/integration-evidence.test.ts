import { describe, expect, it, vi } from "vitest";
import type { PublicClient } from "viem";
import { create_evidence_environment, type RecordedValidation } from "../src/integration/evidence.js";
import { integrationEvidenceHash } from "../src/integration/validation.js";
import { package_integration } from "../src/integration/plugin.js";
import { testPlugin, addr, word } from "./plugin.fixture.js";
import { sampleSuite } from "./integration-suite.fixture.js";

function fixture() {
  const plugin = testPlugin(), identity = package_integration(plugin);
  const suite = sampleSuite({ versionId: identity.version_id, manifestHash: identity.hash });
  const evidence: RecordedValidation = { suite, evidenceHash: integrationEvidenceHash(suite), probes: [],
    lifecycle: { active_credit_id: word("8"), recovered_credit_id: word("9"), action_transactions: {},
      recovery_tx_hashes: [], repayment_tx_hash: word("d") } };
  const input = { plugin, ...identity, manifest_hash: identity.hash, wallet: { address: addr("b"), signTypedData: vi.fn() }, amount: 1n };
  return { evidence, input, identity };
}
const client = {} as PublicClient;
describe("recorded operator environment", () => {
  it("binds the full suite to the plugin and replays each case through the verifier", async () => {
    const { evidence, input } = fixture();
    const environment = create_evidence_environment({ client, evidence, options: { gasLimit: 1_000_000n } });
    evidence.suite.manifestHash = word("f");
    const session = await environment.prepare(input), replay = vi.fn();
    await session.cases.source_identity!({ replay } as never);
    expect(replay).toHaveBeenCalledWith(expect.objectContaining({ id: "source_identity" }));
    expect(Object.keys(session.cases)).toHaveLength(evidence.suite.cases.length);
    expect(session.wallets).toEqual([]);
    await expect(environment.prepare({ ...input, manifest_hash: word("e") })).rejects.toThrow("integration-validation-binding-invalid");
  });
  it("rejects incomplete, tampered or checkpoint-supplied evidence before preparation", () => {
    const { evidence } = fixture();
    expect(() => create_evidence_environment({ client, evidence: { ...evidence, evidenceHash: word("f") },
      options: { gasLimit: 1_000_000n } })).toThrow("integration-evidence-hash-invalid");
    const incomplete = structuredClone(evidence); incomplete.suite.cases.pop();
    expect(() => create_evidence_environment({ client, evidence: incomplete, options: { gasLimit: 1_000_000n } })).toThrow();
    const suite = { format: evidence.suite.format, core: evidence.suite.core, chainId: evidence.suite.chainId,
      versionId: evidence.suite.versionId, manifestHash: evidence.suite.manifestHash, mode: evidence.suite.mode,
      sourceBlock: evidence.suite.sourceBlock, actors: evidence.suite.actors, contracts: evidence.suite.contracts };
    expect(() => create_evidence_environment({ client, evidence, options: { gasLimit: 1_000_000n,
      checkpoint: { suite, cases: evidence.suite.cases } } })).toThrow("integration-evidence-checkpoint-invalid");
  });
});
