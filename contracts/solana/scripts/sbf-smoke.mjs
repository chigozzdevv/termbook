import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';

const [rpcUrl, programAddress] = process.argv.slice(2);
if (!rpcUrl || !programAddress) {
  throw new Error('Usage: node scripts/sbf-smoke.mjs <rpc-url> <program-id>');
}

const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const decode58 = (value) => {
  let number = 0n;
  for (const char of value) {
    const digit = alphabet.indexOf(char);
    if (digit < 0) throw new Error('Invalid base58 address');
    number = number * 58n + BigInt(digit);
  }
  const bytes = [];
  while (number > 0n) {
    bytes.unshift(Number(number & 255n));
    number >>= 8n;
  }
  const zeros = value.match(/^1*/)?.[0].length ?? 0;
  return Buffer.from([...Array(zeros).fill(0), ...bytes]);
};
const encode58 = (bytes) => {
  let number = BigInt(`0x${Buffer.from(bytes).toString('hex')}`);
  let result = '';
  while (number > 0n) {
    result = alphabet[Number(number % 58n)] + result;
    number /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    result = `1${result}`;
  }
  return result;
};
const compact = (value) => {
  const bytes = [];
  do {
    let byte = value & 127;
    value >>= 7;
    if (value) byte |= 128;
    bytes.push(byte);
  } while (value);
  return Buffer.from(bytes);
};
const u64 = (value) => {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(BigInt(value));
  return bytes;
};
const i64 = (value) => {
  const bytes = Buffer.alloc(8);
  bytes.writeBigInt64LE(BigInt(value));
  return bytes;
};
const vector = (bytes) => {
  const length = Buffer.alloc(4);
  length.writeUInt32LE(bytes.length);
  return Buffer.concat([length, bytes]);
};
const fill = (value, length = 32) => Buffer.alloc(length, value);
const deadline = 4_102_444_800;
const request = Buffer.concat([
  fill(1), fill(2), u64(143), fill(3, 20), fill(4, 20), fill(5),
  fill(6), fill(7), fill(8), u64(500_000_000), i64(deadline), u64(1),
]);
const authorization = Buffer.concat([
  u64(143), fill(3, 20), fill(5), fill(9), fill(2), fill(1),
  fill(1), Buffer.from([0]), fill(6), u64(500_000_000), u64(1),
  u64(1), i64(deadline), u64(1),
]);
const action = Buffer.concat([authorization, vector(fill(1, 1)), vector(fill(1, 1))]);
const payout = Buffer.concat([
  fill(6), u64(500_000_000), u64(1), u64(2), i64(deadline),
  vector(fill(1, 1)), vector(fill(1, 1)),
]);
const funding = Buffer.concat([
  fill(12), fill(13), fill(14, 20), fill(15), u64(500_000_000),
  fill(16), u64(1), u64(2), i64(deadline),
  vector(fill(1, 1)), vector(fill(1, 1)),
]);
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const payer = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
const program = decode58(programAddress);
assert.equal(program.length, 32);
const system = Buffer.alloc(32);
const fakeLock = randomBytes(32);
const fakeRecovery = randomBytes(32);

let rpcId = 0;
async function rpc(method, params) {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  });
  const result = await response.json();
  if (result.error) throw new Error(`${method}: ${JSON.stringify(result.error)}`);
  return result.result;
}

await rpc('requestAirdrop', [encode58(payer), 1_000_000_000]);
for (let attempt = 0; attempt < 30; attempt++) {
  const balance = await rpc('getBalance', [encode58(payer), { commitment: 'processed' }]);
  if (balance.value >= 1_000_000_000) break;
  if (attempt === 29) throw new Error('Local airdrop was not funded');
  await new Promise((resolve) => setTimeout(resolve, 300));
}

async function simulate(label, keys, readonlyUnsigned, accounts, instruction, expectedCode) {
  const latest = await rpc('getLatestBlockhash', [{ commitment: 'processed' }]);
  const message = Buffer.concat([
    Buffer.from([1, 0, readonlyUnsigned]),
    compact(keys.length),
    ...keys,
    decode58(latest.value.blockhash),
    compact(1),
    Buffer.from([keys.length - 1]),
    compact(accounts.length),
    Buffer.from(accounts),
    compact(instruction.length),
    instruction,
  ]);
  const signature = sign(null, message, privateKey);
  const transaction = Buffer.concat([compact(1), signature, message]);
  const result = await rpc('simulateTransaction', [transaction.toString('base64'), {
    encoding: 'base64', sigVerify: true, commitment: 'processed',
  }]);
  const actual = result.value.err?.InstructionError?.[1]?.Custom;
  assert.equal(actual, expectedCode, `${label}: ${JSON.stringify(result.value)}`);
  console.log(`${label}: rejected by Solana program with custom error ${actual}`);
}

await simulate('Lock fail closed', [payer, fakeLock, fakeRecovery, system, program], 2,
  [0, 1, 2, 3], Buffer.concat([Buffer.from([0]), request]), 3);
await simulate('Apply invalid lock', [payer, fakeRecovery, program], 1,
  [0, 1], Buffer.concat([Buffer.from([1]), action]), 1);
await simulate('Expire invalid lock', [payer, program], 1,
  [0], Buffer.concat([Buffer.from([2]), action]), 1);
await simulate('RecoveryPayout invalid lock', [payer, fakeLock, fakeRecovery, program], 1,
  [0, 1, 2], Buffer.concat([Buffer.from([3]), payout]), 1);
await simulate('FundRecovery invalid lock', [payer, fakeLock, fakeRecovery, program], 1,
  [0, 1, 2], Buffer.concat([Buffer.from([4]), funding]), 1);
