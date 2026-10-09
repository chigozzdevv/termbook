import { operationFile, operationLock, readConfiguration } from "./testnet-state.mjs";
import fs from "node:fs";
import process from "node:process";
import { log, error } from "node:console";
import { setTimeout as delay } from "node:timers/promises";
import { Buffer } from "node:buffer";
import { canonicalJson, apiAuthorizationMessage, NATIVE_SOL_ASSET_BYTES } from "../packages/schema/dist/index.js";
import { collateralSetupHash, SolanaSourceLockWallet, solanaAlias, solanaPubkeyBytes, decodeSolanaLockRecord } from "../packages/sdk/dist/index.js";
import { viem, artifact, testnetRuntime, writeJsonAtomic } from "./testnet-runtime.mjs";
import { PublicKey, solanaConnection, solanaPayer, journaledSolanaWallet, publicSolanaTransactions } from "./testnet-solana-runtime.mjs";

const mode = process.argv[2];
const { fetch } = globalThis;
const clean = process.argv[3] === "--clean";
if (process.argv.length !== (clean ? 4 : 3) || !["--begin", "--run", "--observe"].includes(mode)) throw new Error("Use --begin, --run, or --observe with optional --clean");
const api = "http://127.0.0.1:3002";
const collateral = 5_000_000n, draw = 1_000_000n, bond = 20_000n;
const erc20 = viem.parseAbi(["function approve(address,uint256) returns(bool)", "function balanceOf(address) view returns(uint256)"]);
const encode = (name, method, args) => viem.encodeFunctionData({ abi: artifact(name).abi, functionName: method, args });

async function main() {
  const runtime = await testnetRuntime(clean ? "solana-clean-e2e" : "solana-e2e", false);
  const { deployment, report, persist, account } = runtime;
  const monad = await runtime.context(10143);
  const m = deployment.addresses[10143], usdc = deployment.tokens[10143].USDC;
  const appSetup = readConfiguration("app");
  const app = appSetup.addresses.ReferenceAssetApp;
  const connection = solanaConnection(), payer = solanaPayer();
  const program = new PublicKey(deployment.solana.programId), genesis = solanaPubkeyBytes(deployment.solana.genesis);
  if (await connection.getGenesisHash() !== deployment.solana.genesis) throw new Error("Solana network mismatch");
  const now = (await monad.client.getBlock()).timestamp;
  const read = (method, args = []) => monad.read("TermbookCore", m.TermbookCore, method, args);
  const fee = async () => monad.client.readContract({ address: await read("solanaWormholeCore"),
    abi: viem.parseAbi(["function messageFee() view returns(uint256)"]), functionName: "messageFee" });
  async function post(route, body) {
    const request = { method: "POST", path: route, bodyHash: viem.hashMessage(canonicalJson(body)) };
    const nonce = await fetch(`${api}/auth/nonce`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ wallet: account.address, ...request }) });
    if (!nonce.ok) throw new Error("API nonce failed");
    const challenge = await nonce.json();
    if (challenge.domain !== "api.termbook.testnet" || challenge.wallet !== account.address.toLowerCase()
      || challenge.message !== apiAuthorizationMessage(challenge.domain, account.address, challenge.nonce, challenge.expiresAt, request)
      || challenge.expiresAt <= Math.floor(Date.now() / 1000)) throw new Error("API challenge mismatch");
    const signature = await account.signMessage({ message: challenge.message });
    const response = await fetch(`${api}${route}`, { method: "POST", headers: { "content-type": "application/json",
      "x-termbook-wallet": account.address, "x-termbook-nonce": challenge.nonce, "x-termbook-signature": signature }, body: canonicalJson(body) });
    if (!response.ok) throw new Error(`API ${route} failed: ${response.status} ${JSON.stringify(await response.json())}`);
    return response.json();
  }
  if (mode === "--begin") {
    if (!(await fetch(`${api}/ready`)).ok) throw new Error("Local services are not ready");
    if (!report.test) {
      const nonce = BigInt(Date.now()), termsHash = viem.keccak256(viem.stringToHex("Termbook SOL collateral live loan"));
      const intentId = viem.keccak256(viem.stringToHex(`SOL loan:${nonce}`));
      const creditId = viem.keccak256(viem.encodeAbiParameters(viem.parseAbiParameters("bytes32,address,address,uint256"), [intentId, account.address, account.address, nonce]));
      const recovery = PublicKey.findProgramAddressSync([Buffer.from("termbook-recovery"), viem.hexToBytes(creditId)], program)[0];
      const solAccount = (key) => ({ namespace: "solana", reference: genesis, accountBytes: solanaPubkeyBytes(key) });
      const binding = { version: 1, monadChainId: 10143, sourceChainId: 501, core: m.TermbookCore, creditId, intentId, termsHash,
        borrower: account.address, house: account.address, sourceVault: solAccount(program.toBase58()),
        asset: { namespace: "solana", reference: genesis, kind: "native", assetBytes: NATIVE_SOL_ASSET_BYTES },
        amount: collateral, owner: solAccount(payer.publicKey.toBase58()), returnRecipient: solAccount(payer.publicKey.toBase58()),
        recoveryVault: solAccount(recovery.toBase58()), setupDeadline: Number(now + 1200n), nonce, verifierVersion: 1n };
      const lockId = collateralSetupHash(binding);
      const lockPda = PublicKey.findProgramAddressSync([Buffer.from("termbook-lock"), viem.hexToBytes(lockId)], program)[0];
      const quote = { borrower: account.address, owner: solanaAlias(genesis, binding.owner.accountBytes), intentId,
        house: account.address, vault: m.HouseVault, sourceChain: 501n, collateralVault: solanaAlias(genesis, binding.sourceVault.accountBytes),
        collateralAsset: solanaAlias(genesis, NATIVE_SOL_ASSET_BYTES), collateralAmount: collateral,
        returnRecipient: solanaAlias(genesis, binding.returnRecipient.accountBytes), settlementAsset: usdc, limit: 2_000_000n,
        bundleId: appSetup.bundleId, setupDeadline: BigInt(binding.setupDeadline), maturity: now + 43_200n, gracePeriod: 60n,
        reservationBond: bond, nonce, expiry: BigInt(binding.setupDeadline), termsHash, revolving: false,
        aprBps: 0n, originationFee: 0n, commitmentFeeBps: 0n,
        reservationPolicyHash: await monad.read("ReservationManager", m.ReservationManager, "policyHashes", [account.address, 1n]),
        bondPayer: account.address, bondRefundRecipient: account.address, signature: "0x" };
      const solana = { quote, sourceGenesis: genesis, sourceVault: binding.sourceVault.accountBytes, sourceAsset: NATIVE_SOL_ASSET_BYTES,
        sourceOwner: binding.owner.accountBytes, returnRecipient: binding.returnRecipient.accountBytes,
        recoveryVault: binding.recoveryVault.accountBytes, verifierVersion: 1n };
      quote.signature = await account.signMessage({ message: { raw: await read("solanaQuoteDigest", [solana]) } });
      report.startedAt = new Date().toISOString();
      report.test = JSON.parse(canonicalJson({ creditId, lockId, lockPda: solanaPubkeyBytes(lockPda.toBase58()), solana, binding })); persist();
    }
    const test = report.test;
    const solana = JSON.parse(JSON.stringify(test.solana));
    for (const field of ["sourceChain", "collateralAmount", "limit", "setupDeadline", "maturity", "gracePeriod", "reservationBond", "nonce", "expiry", "aprBps", "originationFee", "commitmentFeeBps"]) solana.quote[field] = BigInt(solana.quote[field]);
    solana.verifierVersion = BigInt(solana.verifierVersion);
    await monad.send("approve-bond", viem.encodeFunctionData({ abi: erc20, functionName: "approve", args: [m.HouseVault, bond] }), usdc);
    await monad.call("TermbookCore", m.TermbookCore, "acceptSolanaQuote", [solana], "accept");
    await post("/credits", { creditId: test.creditId, borrower: account.address, house: account.address });
    const bind = await monad.send("bind-lock", encode("TermbookCore", "bindSolanaCollateral", [test.creditId, test.lockId, test.lockPda]), m.TermbookCore, await fee());
    await monad.call("AccountFactory", m.AccountFactory, "create", [test.creditId, account.address, m.TermbookCore], "create-account");
    test.account = await monad.read("AccountFactory", m.AccountFactory, "accountOf", [test.creditId]); persist();
    await monad.call("TermbookCore", m.TermbookCore, "bindAccount", [test.creditId, test.account], "bind-account");
    const wallet = journaledSolanaWallet(connection, payer, report, persist, deployment.solana.upgradeAuthority);
    const source = new SolanaSourceLockWallet({ rpcUrl: "https://api.devnet.solana.com", wallet,
      deriveLockPda: async () => new PublicKey(viem.hexToBytes(test.lockPda)).toBase58(),
      deriveRecoveryPda: async () => new PublicKey(viem.hexToBytes(test.binding.recoveryVault.accountBytes)).toBase58() }, genesis);
    const binding = { ...test.binding, amount: BigInt(test.binding.amount), nonce: BigInt(test.binding.nonce), verifierVersion: BigInt(test.binding.verifierVersion) };
    if (!test.lockTx && (await source.observeLock(binding, test.lockId)).state === "missing") {
      const result = await source.submitLock(binding, test.lockId, await read("creditRevision", [test.creditId]),
        { actionHash: await read("solanaLockDigest", [test.creditId]), authorizationTxHash: bind.hash });
      test.lockTx = result.txId; persist();
    }
    if (!test.lockTx) throw new Error("Reconcile the submitted SOL lock before resuming");
    await post("/collateral/solana", { creditId: test.creditId, lockId: test.lockId, lockPda: test.lockPda, sourceTx: test.lockTx });
  }
  if (!report.test) throw new Error("Run --begin first");
  const test = report.test;
  let credit = await read("creditDetails", [test.creditId]);
  if (mode === "--run") {
    if (credit.facility === 4 && !test.drawVerified) {
      const action = { capability: viem.keccak256(viem.stringToHex("deposit")), market: viem.keccak256(viem.stringToHex("Termbook reference USDC position")),
        calls: [{ target: app, spendToken: usdc, spendAmount: String(draw), nativeValue: "0", data: encode("ReferenceAssetApp", "deposit", [draw]) }],
        requiredInput: String(draw), exposureLimit: String(draw) };
      test.execution ??= { drawAmount: String(draw), maxDraw: String(draw), nonce: "1", deadline: String(now + 600n), revision: String(credit.revision),
        signer: account.address, signature: "0x", price: { roundId: "0", referencePrice: "0", updatedAt: "0", authorizedAt: "0", bound: "0", slippageBps: 0, isMax: false } };
      if (test.execution.signature === "0x") test.execution.signature = await account.signMessage({ message: { raw: await read("executionDigest", [test.creditId, action, test.execution]) } });
      persist();
      await monad.call("TermbookCore", m.TermbookCore, "executePlan", [test.creditId, action, test.execution], "borrow-and-deposit");
      const health = await read("previewHealth", [test.creditId]);
      if (health.debt !== draw || health.appValue !== draw || health.sourceValue >= draw || health.healthBps < 12_500n) throw new Error("SOL-backed draw health mismatch");
      test.drawVerified = JSON.parse(canonicalJson(health)); persist();
      credit = await read("creditDetails", [test.creditId]);
    }
    if (test.drawVerified && credit.facility === 4) {
      await monad.call("TermbookCore", m.TermbookCore, "exitApp", [test.creditId, viem.encodeAbiParameters(viem.parseAbiParameters("uint256"), [draw])], "exit-app");
      await monad.call("TermbookCore", m.TermbookCore, "repayFromAccount", [test.creditId, draw], "repay");
      await monad.call("TermbookCore", m.TermbookCore, "startClosing", [test.creditId], "start-closing");
      credit = await read("creditDetails", [test.creditId]);
    }
    if (credit.facility === 5 && !credit.collateralReturned && !test.returnTx) {
      const tx = await monad.send("authorize-return", encode("TermbookCore", "authorizeReturn", [test.creditId, test.lockId, credit.collateralAmount]), m.TermbookCore, await fee());
      test.returnTx = tx.hash; test.returnActionHash = await read("remoteReturnActionHash", [test.creditId]); persist();
    }
    if (credit.facility === 5 && credit.collateralReturned) await monad.call("TermbookCore", m.TermbookCore, "finishClose", [test.creditId], "finish-close");
  }
  credit = await read("creditDetails", [test.creditId]);
  const lock = await connection.getAccountInfo(new PublicKey(viem.hexToBytes(test.lockPda)), "finalized");
  const locked = lock ? decodeSolanaLockRecord(lock.data).remainingAmount : null;
  const position = await monad.read("ReferenceAssetApp", app, "positions", [test.account]);
  const released = await monad.read("CreditAccount", test.account, "released");
  const completed = credit.facility === 6 && credit.debt === 0n && credit.collateralReturned && locked === 0n && position === 0n && released;
  if (completed) test.completedAt ??= new Date().toISOString();
  report.observedAt = new Date().toISOString(); if (mode !== "--observe") persist();
  writeJsonAtomic(operationFile(clean ? "testnet-solana-clean-e2e" : "testnet-solana-e2e"), { network: "testnet", startedAt: report.startedAt,
    observedAt: report.observedAt, completedAt: test.completedAt, core: m.TermbookCore, app, creditId: test.creditId,
    lockId: test.lockId, lockPda: test.lockPda, lockTx: test.lockTx, account: test.account,
    returnTx: test.returnTx, returnActionHash: test.returnActionHash, borrower: account.address,
    sourceOwner: payer.publicKey.toBase58(), collateralLamports: String(collateral), drawAmount: String(draw),
    facility: credit.facility, debt: String(credit.debt), collateralReturned: credit.collateralReturned,
    sourceLockedAmount: locked?.toString(), appPosition: String(position), accountReleased: released, completed,
    drawVerified: test.drawVerified, transactions: report.transactions.map(({ rawTransaction: _raw, ...tx }) => tx),
    solanaTransactions: publicSolanaTransactions(report) });
  log(JSON.stringify({ at: report.observedAt, creditId: test.creditId, facility: credit.facility, debt: String(credit.debt), locked: locked?.toString(), completed }));
  return completed;
}
async function run() {
  const lock = operationLock(clean ? "solana-clean-e2e" : "solana-e2e");
  let descriptor;
  if (mode !== "--observe") {
    if (fs.existsSync(lock)) {
      const owner = Number(fs.readFileSync(lock, "utf8"));
      if (!Number.isSafeInteger(owner) || owner <= 0) throw new Error("SOL test lock is invalid");
      try { process.kill(owner, 0); throw new Error("SOL test runner is already active"); }
      catch (cause) {
        if (cause.code !== "ESRCH") throw cause;
        fs.unlinkSync(lock);
      }
    }
    descriptor = fs.openSync(lock, "wx", 0o600); fs.writeFileSync(descriptor, String(process.pid));
  }
  try {
    const deadline = Date.now() + 30 * 60_000;
    do { if (await main() || mode !== "--run") return; await delay(2000); } while (Date.now() < deadline);
    throw new Error("SOL E2E timed out; resume with --run");
  } finally { if (descriptor !== undefined) { fs.closeSync(descriptor); fs.unlinkSync(lock); } }
}
run().catch((cause) => { error(cause instanceof Error ? cause.message.split("\n")[0] : "SOL E2E failed"); process.exitCode = 1; });
