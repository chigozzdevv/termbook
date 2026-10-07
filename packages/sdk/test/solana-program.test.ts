import { describe, expect, it } from "vitest";
import { hexToBytes } from "viem";
import { SOLANA_DEVNET_GENESIS, verifySolanaProgramAuthority } from "../src/collateral/solana-program.js";
import { solanaPubkeyBase58 } from "../src/collateral/solana.js";

const authority = `0x${"12".repeat(32)}` as const;
function mutable() { const data = new Uint8Array(45); data[12] = 1; data.set(hexToBytes(authority), 13); return data; }
describe("Solana program upgrade authority", () => {
  it("requires explicit expected authority on the paired testnet", () => {
    expect(() => verifySolanaProgramAuthority(mutable(), SOLANA_DEVNET_GENESIS, 10143n, solanaPubkeyBase58(authority))).not.toThrow();
    expect(() => verifySolanaProgramAuthority(mutable(), SOLANA_DEVNET_GENESIS, 10143n)).toThrow("solana-program-not-immutable");
    expect(() => verifySolanaProgramAuthority(mutable(), SOLANA_DEVNET_GENESIS, 10143n, solanaPubkeyBase58(`0x${"13".repeat(32)}`)))
      .toThrow("solana-program-not-immutable");
  });
  it("rejects mutable programs on mainnet and malformed authority tags", () => {
    expect(() => verifySolanaProgramAuthority(mutable(), SOLANA_DEVNET_GENESIS, 143n, solanaPubkeyBase58(authority)))
      .toThrow("solana-program-not-immutable");
    const data = mutable(); data[12] = 2;
    expect(() => verifySolanaProgramAuthority(data, SOLANA_DEVNET_GENESIS, 10143n, solanaPubkeyBase58(authority)))
      .toThrow("solana-program-authority-invalid");
    data[12] = 0;
    expect(() => verifySolanaProgramAuthority(data, SOLANA_DEVNET_GENESIS, 143n)).not.toThrow();
  });
});
