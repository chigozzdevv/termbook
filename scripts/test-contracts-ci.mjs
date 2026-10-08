import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { log } from "node:console";

const [shardValue, countValue] = process.argv.slice(2);
if (process.argv.length !== 4 || !/^\d+$/.test(shardValue ?? "") || !/^\d+$/.test(countValue ?? "")) {
  throw new Error("Use node scripts/test-contracts-ci.mjs <shard> <count>");
}
const shard = Number(shardValue), count = Number(countValue);
if (!Number.isSafeInteger(shard) || !Number.isSafeInteger(count) || count < 1 || count > 16 || shard >= count) {
  throw new Error("Invalid Solidity test shard");
}
function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? files(file) : entry.isFile() && entry.name.endsWith(".t.sol") ? [file] : [];
  });
}
const all = files("contracts/evm/test").sort();
const relative = (file) => path.relative("contracts/evm", file).split(path.sep).join("/");
const selected = all.filter((_, index) => index % count === shard);
if (!selected.length) throw new Error("Empty Solidity test shard");
const skipped = all.filter((_, index) => index % count !== shard).map(relative);
const pattern = `{${selected.map(relative).join(",")}}`;
log(`Solidity shard ${shard + 1}/${count}: ${selected.length}/${all.length} test files`);
const result = spawnSync("forge", ["test", "--root", "contracts/evm", "-j", "1", "--match-path", pattern,
  ...(skipped.length ? ["--skip", ...skipped] : [])], {
  stdio: "inherit", env: { ...process.env, FOUNDRY_VIA_IR: "true" },
});
if (result.error) throw result.error;
if (result.signal) throw new Error(`Solidity shard terminated: ${result.signal}`);
process.exitCode = result.status ?? 1;
