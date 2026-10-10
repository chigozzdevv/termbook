import { acceptanceCases, apiAuthorizationMessage, canonicalJson, selectCapability, executionKey,
  type AcceptanceCaseId, type IntegrationSuite } from "@termbook/schema";
import { hashMessage, type PublicClient, type Hex } from "viem";
import type { Wallet } from "../types/client.types.js";
import { HttpClient } from "../transport/http.js";
import { IntegrationValidationRunner, type IntegrationValidationOptions, type ValidationCheckpoint } from "./validation.js";
import { package_integration, type plugin } from "./plugin.js";
import { verify_definition } from "./pins.js";
import { validate_callbacks, type ActionProbe } from "./callbacks.js";

export type ValidationSession = {
  context: ValidationCheckpoint["suite"];
  wallets: Wallet[];
  cases: Partial<Record<AcceptanceCaseId, (runner: IntegrationValidationRunner) => Promise<void>>>;
  exclusions: IntegrationSuite["exclusions"];
  probes: ActionProbe[];
  lifecycle: { active_credit_id: Hex; recovered_credit_id: Hex;
    action_transactions: Record<string, { credit_id: Hex; tx_hash: Hex }>;
    recovery_tx_hashes: Hex[]; repayment_tx_hash: Hex };
};
export type ValidationEnvironment = {
  client: PublicClient;
  suite_client?: PublicClient;
  options: IntegrationValidationOptions;
  prepare(input: { plugin: plugin; wallet: Wallet; amount: bigint; version_id: Hex; manifest_hash: Hex }): Promise<ValidationSession>;
};
export type AuthorConfig = {
  application_id: string; wallet: Wallet; api_base: string; validation_environment?: ValidationEnvironment;
};
export type ValidationResult = { id: string; passed: boolean; version_id: Hex; package_hash: Hex; failures: string[] };
export type RegistrationResult = { integration_id: string; version_id: Hex;
  status: "awaiting_approval"; } | { integration_id: string; version_id: Hex; status: "active"; app_token: string };

class AuthorTransport {
  private readonly http: HttpClient;
  constructor(private readonly config: AuthorConfig) {
    const url = new URL(config.api_base);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))
      || url.username || url.password || url.search || url.hash || url.pathname !== "/"
      || !/^[a-f0-9-]{36}$/i.test(config.application_id) || !config.wallet.signMessage) throw new Error("integration-author-config-invalid");
    this.http = new HttpClient(url.origin);
  }
  async post<T>(path: string, body: unknown): Promise<T> {
    const wallet = this.config.wallet;
    const request = { method: "POST" as const, path, bodyHash: hashMessage(canonicalJson(body)) };
    const challenge = await this.http.post<{ wallet: string; message: string; nonce: string; expiresAt: number; domain: string }>(
      "/auth/nonce", { wallet: wallet.address, ...request });
    if (challenge.wallet?.toLowerCase() !== wallet.address.toLowerCase()
      || !/^[a-f0-9]{64}\.[0-9]{1,12}$/.test(challenge.nonce)
      || !Number.isSafeInteger(challenge.expiresAt) || challenge.expiresAt <= Math.floor(Date.now() / 1000)
      || challenge.nonce.split(".")[1] !== String(challenge.expiresAt)
      || typeof challenge.domain !== "string" || /[\r\n]/.test(challenge.domain)
      || challenge.message !== apiAuthorizationMessage(challenge.domain, wallet.address, challenge.nonce, challenge.expiresAt, request)) {
      throw new Error("auth-challenge-invalid");
    }
    return this.http.post(path, body, { "x-termbook-wallet": wallet.address,
      "x-termbook-signature": await wallet.signMessage!(challenge.message), "x-termbook-nonce": challenge.nonce });
  }
}

export class Integrations {
  private readonly transport: AuthorTransport;
  constructor(private readonly config: AuthorConfig) { this.transport = new AuthorTransport(config); }

  async validate(input: { plugin: plugin; wallet: Wallet; amount: bigint }): Promise<ValidationResult> {
    if (typeof input.amount !== "bigint" || input.amount <= 0n || input.amount >= 2n ** 256n
      || input.wallet.address.toLowerCase() !== this.config.wallet.address.toLowerCase()) throw new Error("integration-validation-input-invalid");
    const environment = this.config.validation_environment;
    if (!environment) throw new Error("integration-validation-environment-unavailable");
    const packaged = package_integration(input.plugin);
    await verify_definition(environment.client, packaged.definition);
    if (await environment.client.getChainId() !== packaged.definition.chain_id) throw new Error("integration-chain-mismatch");
    const session = await environment.prepare({ ...input, version_id: packaged.version_id, manifest_hash: packaged.hash });
    if (session.context.versionId.toLowerCase() !== packaged.version_id || session.context.manifestHash.toLowerCase() !== packaged.hash
      || session.context.chainId !== packaged.definition.chain_id
      || session.context.actors.borrower.toLowerCase() !== input.wallet.address.toLowerCase()
      || packaged.definition.pins.some((pin) => !session.context.contracts.some((p) => !p.fixture && p.target.toLowerCase() === pin.target.toLowerCase()
        && p.codeHash.toLowerCase() === pin.code_hash.toLowerCase()))) throw new Error("integration-validation-binding-invalid");
    const ids = Object.keys(acceptanceCases) as AcceptanceCaseId[];
    if (ids.some((id) => Boolean(session.cases[id]) === session.exclusions.some((e) => e.id === id))
      || Object.keys(session.cases).some((id) => !ids.includes(id as AcceptanceCaseId))) throw new Error("integration-scenarios-incomplete");
    if (environment.suite_client && session.context.mode !== "fork") throw new Error("integration-fork-client-invalid");
    const runner = new IntegrationValidationRunner(environment.suite_client ?? environment.client, session.context,
      [input.wallet, ...session.wallets.filter((w) => w.address.toLowerCase() !== input.wallet.address.toLowerCase())], environment.options);
    for (const id of ids) { const scenario = session.cases[id]; if (scenario) await runner.run(id, scenario); }
    const report = runner.finish(session.exclusions);
    if (session.probes.some((probe) => {
      const evidence = session.lifecycle.action_transactions[executionKey(selectCapability(packaged.definition.actions, probe.action))];
      return !evidence || evidence.credit_id.toLowerCase() !== probe.credit_id.toLowerCase()
        || evidence.tx_hash.toLowerCase() !== probe.tx_hash.toLowerCase();
    })) throw new Error("integration-probe-evidence-mismatch");
    await validate_callbacks(environment.client, input.plugin, { core: session.context.core as `0x${string}`,
      active_credit_id: session.lifecycle.active_credit_id, recovered_credit_id: session.lifecycle.recovered_credit_id, probes: session.probes });
    await verify_definition(environment.client, packaged.definition);
    if (package_integration(input.plugin).hash !== packaged.hash) throw new Error("integration-definition-changed");
    const lifecycle = session.lifecycle;
    const result = await this.transport.post<ValidationResult>("/integrations/packages/validate", {
      application_id: this.config.application_id, definition: packaged.definition,
      acceptance: { evidenceHash: report.evidenceHash, suite: report.suite,
        activeCreditId: lifecycle.active_credit_id, recoveredCreditId: lifecycle.recovered_credit_id,
        actionTransactions: Object.fromEntries(Object.entries(lifecycle.action_transactions).map(([name, tx]) =>
          [name, { creditId: tx.credit_id, txHash: tx.tx_hash }])),
        recoveryTxHashes: lifecycle.recovery_tx_hashes, repaymentTxHash: lifecycle.repayment_tx_hash },
    });
    if (!/^[a-f0-9-]{36}$/i.test(result.id) || result.version_id !== packaged.version_id
      || result.package_hash !== packaged.hash || !Array.isArray(result.failures)
      || typeof result.passed !== "boolean" || result.passed && result.failures.length !== 0) throw new Error("integration-validation-response-invalid");
    return result;
  }

  async register(input: { validation_id: string }): Promise<RegistrationResult> {
    if (!/^[a-f0-9-]{36}$/i.test(input.validation_id)) throw new Error("integration-validation-id-invalid");
    return this.registration("/integrations/packages/register", { application_id: this.config.application_id, ...input });
  }
  async status(input: { validation_id: string }): Promise<RegistrationResult> { return this.register(input); }
  async approve(input: { validation_id: string; fork_review_signature?: Hex }): Promise<RegistrationResult> {
    if (!/^[a-f0-9-]{36}$/i.test(input.validation_id)) throw new Error("integration-validation-id-invalid");
    return this.registration("/integrations/packages/approve", input);
  }
  private async registration(path: string, input: { validation_id: string; application_id?: string; fork_review_signature?: Hex }): Promise<RegistrationResult> {
    const result = await this.transport.post<RegistrationResult>(path, input);
    if (result.integration_id !== input.validation_id || !/^0x[a-f0-9]{64}$/i.test(result.version_id)
      || !["active", "awaiting_approval"].includes(result.status)
      || result.status === "active" && !/^tbk_[a-f0-9]{64}$/.test(result.app_token)) throw new Error("integration-registration-response-invalid");
    return result;
  }
}

export function create_sdk(config: AuthorConfig): { integrations: Integrations } {
  return { integrations: new Integrations(config) };
}
