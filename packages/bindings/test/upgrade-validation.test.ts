import { describe, expect, it } from "vitest";
import { validateUpgradeArtifact, withEnumMembers } from "../../../scripts/deploy/upgrade-validation.mjs";

function fixture() {
  return { abi: [{ type: "function", name: "balance", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" }],
    storageLayout: { storage: [{ contract: "Vault", label: "balance", slot: "0", offset: 0, type: "t_uint256", src: "Vault.sol:1" }],
      types: { t_uint256: { label: "uint256", numberOfBytes: "32", encoding: "inplace" } } },
    bytecode: { object: "0x6000" }, deployedBytecode: { object: "0x00", immutableReferences: {} } };
}
describe("upgrade artifact validation", () => {
  it("allows storage additions that preserve existing fields", () => {
    const before = fixture(), after = fixture();
    after.storageLayout.storage.push({ ...after.storageLayout.storage[0]!, label: "counter", slot: "1" });
    expect(() => validateUpgradeArtifact(before, after)).not.toThrow();
  });
  it("rejects overwritten slots and changed existing function outputs", () => {
    const before = fixture(), after = fixture();
    after.storageLayout.storage[0]!.slot = "1";
    expect(() => validateUpgradeArtifact(before, after)).toThrow();
    const changed = fixture(); changed.abi[0]!.outputs[0]!.type = "address";
    expect(() => validateUpgradeArtifact(before, changed)).toThrow("Incompatible function");
  });
  it("rejects removed functions, reserved selectors, and unresolved bytecode", () => {
    const before = fixture(), after = fixture(); after.abi = [];
    expect(() => validateUpgradeArtifact(before, after)).toThrow("Incompatible function");
    const collision = fixture(); collision.abi[0]!.name = "proxyAdmin";
    expect(() => validateUpgradeArtifact(before, collision)).toThrow("Proxy selector collision");
    const linked = fixture(); linked.bytecode.object = "0x__library__";
    expect(() => validateUpgradeArtifact(before, linked)).toThrow("Unresolved implementation bytecode");
  });
  it("checks nested mapping fields across compiler type identifiers", () => {
    const nested = (id: number, debtType = "t_uint256") => {
      const value = fixture();
      const struct = `t_struct(Credit)${id}_storage`;
      const mapping = `t_mapping(t_bytes32,${struct})`;
      value.storageLayout = {
        storage: [{ contract: "Vault", label: "credits", slot: "0", offset: 0, type: mapping, src: "Vault.sol:1" }],
        types: {
          t_bytes32: { label: "bytes32", numberOfBytes: "32", encoding: "inplace" },
          t_uint256: { label: "uint256", numberOfBytes: "32", encoding: "inplace" },
          t_address: { label: "address", numberOfBytes: "20", encoding: "inplace" },
          [struct]: { label: "struct Vault.Credit", numberOfBytes: "32", encoding: "inplace",
            members: [{ label: "debt", slot: "0", offset: 0, type: debtType }] },
          [mapping]: { label: "mapping(bytes32 => struct Vault.Credit)", numberOfBytes: "32", encoding: "mapping",
            key: "t_bytes32", value: struct },
        },
      } as typeof value.storageLayout;
      return value;
    };
    expect(() => validateUpgradeArtifact(nested(12), nested(99))).not.toThrow();
    expect(() => validateUpgradeArtifact(nested(12), nested(99, "t_address"))).toThrow();
  });
  it("checks enum ordering using the compiled source hash", () => {
    const value = fixture();
    value.storageLayout.storage[0]!.type = "t_enum(Phase)12";
    value.storageLayout.types = { "t_enum(Phase)12": { label: "enum Vault.Phase", numberOfBytes: "1", encoding: "inplace" } } as typeof value.storageLayout.types;
    const metadata = { sources: { "Vault.sol": { keccak256: "source-hash" } } };
    const source = (members: string[], hash = "source-hash") => ({
      metadata: { sources: { "Vault.sol": { keccak256: hash } } },
      ast: { absolutePath: "Vault.sol", nodes: [{ nodeType: "EnumDefinition", canonicalName: "Vault.Phase",
        members: members.map((name) => ({ name })) }] },
    });
    const before = withEnumMembers({ ...value, metadata }, [source(["Open", "Closed"])]);
    const after = withEnumMembers({ ...value, metadata }, [source(["Closed", "Open"])]);
    expect(() => validateUpgradeArtifact(before, before)).not.toThrow();
    expect(() => validateUpgradeArtifact(before, after)).toThrow();
    expect(() => withEnumMembers({ ...value, metadata }, [source(["Open", "Closed"], "stale-hash")])).toThrow("Missing enum storage metadata");
  });
  it("preserves the event signatures and indexed fields used by indexers", () => {
    const event = { type: "event", name: "CreditRepaid", anonymous: false,
      inputs: [{ name: "creditId", type: "bytes32", indexed: true }] };
    const before = { ...fixture(), abi: [...fixture().abi, event] };
    expect(() => validateUpgradeArtifact(before, fixture())).toThrow("Incompatible event");
    const after = { ...fixture(), abi: [...fixture().abi, { ...event, inputs: [{ ...event.inputs[0], indexed: false }] }] };
    expect(() => validateUpgradeArtifact(before, after)).toThrow("Incompatible event");
  });
});
