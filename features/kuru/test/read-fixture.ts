import { writeFile } from "node:fs/promises";
import { encodeAbiParameters, zeroHash } from "viem";
import { compile_read_program, readProgramAbi } from "@termbook/sdk";
import { kuru_quote_program } from "../read.js";

for (const [name, size, price] of [
  ["kuru-read", 1_000_000n, 10_000n],
  ["kuru-testnet-read", 10_000_000_000n, 100_000_000n],
] as const) {
  const result = compile_read_program(kuru_quote_program(zeroHash, size, price, 18n, 6n));
  const program = encodeAbiParameters(readProgramAbi[0].inputs.slice(1), [result.program]);
  await writeFile(new URL(`../../../contracts/evm/test/fixtures/${name}.json`, import.meta.url), `${JSON.stringify({ program })}\n`);
}
