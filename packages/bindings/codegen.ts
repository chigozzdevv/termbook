import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(new URL("../..", import.meta.url).pathname);
const artifacts = resolve(root, "contracts/evm/out");
const output = resolve(root, "packages/bindings/src/generated/abi");
const contracts = {
  TermbookCore: "termbook-core",
  CreditAccount: "credit-account",
  HouseVault: "house-vault",
  CollateralVault: "collateral-vault",
  NativeCollateralVault: "native-collateral-vault",
  RemoteCollateralController: "remote-collateral-controller",
  SourceRecoveryVault: "source-recovery-vault",
  SettlementInbox: "settlement-inbox",
  AppGateway: "app-gateway",
  RiskEngine: "risk-engine",
  AccountFactory: "account-factory",
  InboxFactory: "inbox-factory",
  IntegrationRegistry: "integration-registry",
  ProtocolGovernance: "protocol-governance",
  Guardian: "guardian",
  HouseRegistry: "house-registry",
  HousePolicyGovernor: "house-policy-governor",
  VerifierRegistry: "verifier-registry",
  EthereumBeaconLightClient: "ethereum-beacon-light-client",
  MonadBftLightClient: "monad-bft-light-client",
  MonadEpochCommitter: "monad-epoch-committer",
  EthereumVerifier: "ethereum-verifier",
  SolanaVerifier: "solana-verifier",
  WormholeSolanaAccountClient: "wormhole-solana-account-client",
  WormholeEvmMessageClient: "wormhole-evm-message-client",
  WormholeEthereumPublisher: "wormhole-ethereum-publisher",
  WormholeEthereumVerifier: "wormhole-ethereum-verifier",
  WormholeMonadVerifier: "wormhole-monad-verifier",
  MonadVerifier: "monad-verifier",
  OracleRegistry: "oracle-registry",
  HealthSource: "health-source",
  CollateralHealthReader: "collateral-health-reader",
  AppHealthReader: "app-health-reader",
  AppExitVerifier: "app-exit-verifier",
  IAppCallValidator: "app-call-validator",
  StaticCallValidator: "static-call-validator",
  IAppStateReader: "app-state-reader",
  FlowExecutor: "flow-executor",
} as const;

await mkdir(output, { recursive: true });
for (const [contract, file] of Object.entries(contracts)) {
  const artifactPath = resolve(artifacts, `${contract}.sol/${contract}.json`);
  const artifact = JSON.parse(await readFile(artifactPath, "utf8")) as { abi: unknown[] };
  const identifier = file
    .split("-")
    .map((part, index) => (index === 0 ? part : `${part[0].toUpperCase()}${part.slice(1)}`))
    .join("");
  const text = `export const ${identifier}Abi = ${JSON.stringify(artifact.abi, null, 2)} as const;\n`;
  await writeFile(resolve(output, `${file}.ts`), text);
}

const generatedIndex = resolve(root, "packages/bindings/src/generated/index.ts");
const exports = Object.values(contracts).map((file) => `export * from "./abi/${file}.js";`).join("\n");
await writeFile(generatedIndex, `${exports}\nexport * from "./contracts.js";\nexport * from "./deployments.js";\n`);
