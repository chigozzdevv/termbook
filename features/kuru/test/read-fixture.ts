import { writeFile } from "node:fs/promises";
import { encodeAbiParameters, zeroHash } from "viem";
import { compile_read_program, readProgramAbi } from "@termbook/sdk";
import { kuru_quote_program } from "../read.js";

const result = compile_read_program(kuru_quote_program(zeroHash, 1_000_000n, 10_000n, 18n, 6n));
const program = encodeAbiParameters(readProgramAbi[0].inputs.slice(1), [result.program]);
await writeFile(new URL("../../../contracts/evm/test/fixtures/kuru-read.json", import.meta.url), `${JSON.stringify({ program })}\n`);
