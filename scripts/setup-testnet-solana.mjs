import { alreadyConfigured, writeConfiguration, clearOperation } from "./testnet-state.mjs";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { log, error } from "node:console";
import { solanaAlias, solanaPubkeyBytes } from "../packages/sdk/dist/index.js";
import { NATIVE_SOL_ASSET_BYTES } from "../packages/schema/dist/index.js";
import { root, viem, artifact, testnetRuntime, writeJsonAtomic } from "./testnet-runtime.mjs";
import { Keypair, SystemProgram, solanaConnection, solanaPayer, journaledSolanaWallet, publicSolanaTransactions } from "./testnet-solana-runtime.mjs";

const simulate = process.argv[2] === "--simulate";
if (process.argv.length !== 3 || !["--simulate", "--broadcast"].includes(process.argv[2])) throw new Error("Use --simulate or --broadcast");
const pyth = "0xFC6bd9F9f0c6481c6Af3A7Eb46b296A5B85ed379";
const pythId = "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
const solId = viem.keccak256(viem.stringToHex("testnet:SOL/USD"));
const ratioId = viem.keccak256(viem.stringToHex("testnet:SOL/USDC:live"));
const usdcId = viem.keccak256(viem.stringToHex("testnet:USDC/USD"));

async function main() {
  if (!simulate && alreadyConfigured("solana")) { clearOperation("solana-setup"); log(JSON.stringify({ configured: true, step: "solana" })); return; }
  const runtime = await testnetRuntime("solana-setup", simulate);
  const { deployment, report, persist } = runtime;
  const monad = await runtime.context(10143);
  const m = deployment.addresses[10143];
  const genesis = solanaPubkeyBytes(deployment.solana.genesis);
  const asset = solanaAlias(genesis, NATIVE_SOL_ASSET_BYTES);
  const usdc = deployment.tokens[10143].USDC;
  const feed = await monad.deploy("PythPriceFeed", [pyth, pythId, 300n, 200n]);
  await monad.govern("OracleRegistry", m.OracleRegistry, "setFeed", [solId, feed, 300n, 18]);
  const ratio = await monad.deploy("LiveRatioPriceFeed", [m.OracleRegistry, solId, usdcId], "SOLLiveRatioPriceFeed");
  const price = await monad.read("OracleRegistry", m.OracleRegistry, "read", [solId]);
  for (const action of report.transactions.filter((tx) => tx.name.startsWith("queue:"))) {
    const id = action.name.slice(6);
    const governance = m.ProtocolGovernance;
    if (await monad.read("ProtocolGovernance", governance, "queuedAt", [id]) === 0n) continue;
    const tx = await monad.client.getTransaction({ hash: action.hash });
    const { args } = viem.decodeFunctionData({ abi: artifact("ProtocolGovernance").abi, data: tx.input });
    if (args[0].toLowerCase() !== m.TermbookCore.toLowerCase()) continue;
    const policy = viem.decodeFunctionData({ abi: artifact("TermbookCore").abi, data: args[2] });
    if (policy.functionName !== "setRemoteSalePolicy" || policy.args[4] === ratioId) continue;
    await monad.call("ProtocolGovernance", governance, "cancel", args, `cancel:${id}`);
  }
  await monad.govern("OracleRegistry", m.OracleRegistry, "setFeed", [ratioId, ratio, 90_000n, 18]);
  await monad.govern("TermbookCore", m.TermbookCore, "setRemoteSalePolicy", [501n, asset, usdc, m.OracleRegistry, ratioId, 9, 9500, 100_000_000n]);
  await monad.govern("CollateralHealthReader", m.CollateralHealthReader, "setMarket", [501n, asset, usdc, ratioId, 9, 8000, 50_000n]);
  if (!simulate) {
    const connection = solanaConnection();
    if (await connection.getGenesisHash() !== deployment.solana.genesis) throw new Error("Solana network mismatch");
    const file = path.join(root, ".testnet/solana-source-keeper.json");
    if (!fs.existsSync(file)) writeJsonAtomic(file, Array.from(Keypair.generate().secretKey));
    const keeper = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file))));
    const payer = solanaPayer();
    if (keeper.publicKey.equals(payer.publicKey)) throw new Error("Solana keeper must be distinct from borrower");
    const balance = await connection.getBalance(keeper.publicKey);
    if (!report.keeperFunded && balance < 200_000_000) {
      report.keeperTopUp ??= 200_000_000 - balance; persist();
      const transfer = SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: keeper.publicKey, lamports: report.keeperTopUp });
      const wallet = journaledSolanaWallet(connection, payer, report, persist, deployment.solana.upgradeAuthority);
      await wallet.sendInstruction({ programId: transfer.programId.toBase58(), keys: transfer.keys.map(({ pubkey, ...meta }) => ({ ...meta, pubkey: pubkey.toBase58() })), data: transfer.data });
    }
    if (!report.keeperFunded) { report.keeperFunded = true; persist(); }
    const envFile = path.join(root, ".env");
    let env = fs.readFileSync(envFile, "utf8");
    const existing = JSON.parse(env.match(/^COLLATERAL_MARKETS=(.*)$/m)?.[1] ?? "[]").filter((market) => market.id !== "sol-devnet");
    existing.push({ id: "sol-devnet", label: "SOL (devnet)", kind: "solana", chainId: 501, decimals: 9,
      rpcUrl: "https://api.devnet.solana.com", genesis, program: solanaPubkeyBytes(deployment.solana.programId),
      asset: NATIVE_SOL_ASSET_BYTES, testnetUpgradeAuthority: deployment.solana.upgradeAuthority });
    for (const [name, value] of Object.entries({ SOLANA_SOURCE_KEEPER_KEY_FILE: file,
      SOLANA_TESTNET_UPGRADE_AUTHORITY: deployment.solana.upgradeAuthority, COLLATERAL_MARKETS: JSON.stringify(existing) })) {
      env = env.replace(new RegExp(`^${name}=.*\\n?`, "m"), ""); env += `${name}=${value}\n`;
    }
    fs.writeFileSync(envFile, env, { mode: 0o600 });
    report.keeper = keeper.publicKey.toBase58();
  }
  report.completedAt = new Date().toISOString(); persist();
  const publicReport = { network: "testnet", core: m.TermbookCore, completedAt: report.completedAt,
    sourceChain: 501, genesis, asset, pyth, pythId, priceId: ratioId, addresses: report.addresses, keeper: report.keeper,
    transactions: report.transactions.map(({ rawTransaction: _raw, ...tx }) => tx), solanaTransactions: publicSolanaTransactions(report) };
  if (!simulate) writeConfiguration("solana", publicReport);
  log(JSON.stringify({ simulated: simulate, transactions: report.transactions.length, price: price[0].toString(), keeper: report.keeper }));
  if (!simulate) clearOperation("solana-setup", false);
}
main().catch((cause) => { error(cause instanceof Error ? cause.message.split("\n")[0] : "Solana setup failed"); process.exitCode = 1; });
