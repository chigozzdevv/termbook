import type { ClientConfig, ResolvedClientConfig } from "../types/client.types.js";
import type { IntentRequest } from "../types/intent.types.js";
import { Intent } from "../intent/intent.js";
import { Credit } from "../credit/credit.js";
import { House } from "../house/house.js";
import { Catalog } from "../catalog/catalog.js";
import { RpcClient } from "../transport/rpc.js";
import { Signer } from "../wallet/signer.js";
import { Settlement } from "../settlement/settlement.js";
import { HttpClient } from "../transport/http.js";
import type { CollateralSetupBinding } from "@termbook/schema";
import { CollateralSetup, restoreCollateralSetup, type CollateralSetupOptions } from "../collateral/setup.js";
import { resolveClientConfig } from "./config.js";
import type { CollateralMarket } from "@termbook/schema";
import type { SourceLockWallet } from "../collateral/setup.js";
import { apiAuthorizationMessage, canonicalJson, assertActionRoutes, assertStandardDefinition, capabilityDefinitionSchema, useCaseSchema } from "@termbook/schema";
import { hashMessage } from "viem";
import { connectSourceWallet } from "../modal/source-wallet.js";
import { TermbookModal, type OpenOptions } from "../modal/modal.js";

export class TermbookClient {
  private resolvedConfig?: ResolvedClientConfig;
  private resolvedRpc?: RpcClient;
  private initialization?: Promise<void>;
  private readonly input: ClientConfig;
  signer: Signer;
  settlement: Settlement;

  constructor(config: ClientConfig) {
    const appToken = config.appToken ?? config.app_token;
    const rpcUrl = config.rpcUrl ?? config.rpc_url;
    const chainId = config.chainId ?? config.chain_id;
    if (!appToken || !config.wallet) throw new Error("client-config-invalid");
    this.input = config;
    if (config.core || rpcUrl || chainId) {
      const core = config.core;
      if (!core || !rpcUrl || !chainId || chainId <= 0) throw new Error("client-config-invalid");
      if (config.actions) {
        const category = useCaseSchema.safeParse(config.use_case);
        if (!category.success) throw new Error("client-config-invalid");
        const actions = config.actions.map((action) => capabilityDefinitionSchema.parse(action));
        assertActionRoutes(actions); actions.forEach((action) => assertStandardDefinition(action, category.data));
        config = { ...config, actions };
      }
      const resolved: ResolvedClientConfig = { ...config, appToken, core, rpcUrl, chainId };
      this.resolvedConfig = resolved;
      this.resolvedRpc = new RpcClient(resolved);
    }
    this.signer = new Signer(config.wallet);
    this.settlement = new Settlement(this);
  }

  get config(): ResolvedClientConfig {
    if (!this.resolvedConfig) throw new Error("client-not-ready");
    return this.resolvedConfig;
  }

  get rpc(): RpcClient {
    if (!this.resolvedRpc) throw new Error("client-not-ready");
    return this.resolvedRpc;
  }

  async ready(): Promise<void> {
    if (this.resolvedConfig) return;
    if (!this.initialization) {
      this.initialization = resolveClientConfig(this.input).then((config) => {
        this.resolvedConfig = config;
        this.resolvedRpc = new RpcClient(config);
      }).catch((error: unknown) => {
        this.initialization = undefined;
        throw error;
      });
    }
    await this.initialization;
  }

  intent(req: IntentRequest): Intent {
    return new Intent(this, req);
  }

  open(options?: OpenOptions): TermbookModal {
    return new TermbookModal(this, options);
  }

  credit(id: `0x${string}`): Credit {
    return new Credit(this, id);
  }

  async collateral_setup(binding: CollateralSetupBinding | string, options: CollateralSetupOptions = {}): Promise<CollateralSetup> {
    await this.ready();
    if (typeof binding === "string") {
      const restored = restoreCollateralSetup(binding);
      return new CollateralSetup(this, restored.binding, { ...options, checkpoint: restored.checkpoint });
    }
    return new CollateralSetup(this, binding, options);
  }

  house(id: `0x${string}`): House {
    return new House(this, id);
  }

  get catalog(): Catalog {
    return new Catalog(this);
  }

  async sourceWallet(market: CollateralMarket): Promise<SourceLockWallet> {
    return connectSourceWallet(this, market, this.input.sourceWalletResolver);
  }

  async authenticatedPost<T>(path: string, body: unknown): Promise<T> {
    await this.ready();
    if (!this.config.apiBase) throw new Error("api-required");
    if (!this.config.wallet.signMessage) throw new Error("wallet-message-signing-unavailable");
    const http = new HttpClient(this.config.apiBase);
    const request = { method: "POST" as const, path, bodyHash: hashMessage(canonicalJson(body)) };
    const challenge = await http.post<{ wallet: string; message: string; nonce: string; expiresAt: number; domain: string }>(
      "/auth/nonce", { wallet: this.signer.address(), ...request });
    if (challenge.wallet?.toLowerCase() !== this.signer.address().toLowerCase()
      || !/^[a-f0-9]{64}\.[0-9]{1,12}$/.test(challenge.nonce)
      || !Number.isSafeInteger(challenge.expiresAt) || challenge.expiresAt <= Math.floor(Date.now() / 1000)
      || challenge.nonce.split(".")[1] !== String(challenge.expiresAt)
      || typeof challenge.domain !== "string" || /[\r\n]/.test(challenge.domain)
      || challenge.message !== apiAuthorizationMessage(challenge.domain, this.signer.address(),
        challenge.nonce, challenge.expiresAt, request)) throw new Error("auth-challenge-invalid");
    const signature = await this.config.wallet.signMessage(challenge.message);
    return http.post<T>(path, body, {
      "x-termbook-app-token": this.config.appToken,
      "x-termbook-wallet": this.signer.address(),
      "x-termbook-signature": signature,
      "x-termbook-nonce": challenge.nonce,
    });
  }
}

export function createTermbook(config: ClientConfig): TermbookClient {
  return new TermbookClient(config);
}

export function create_termbook(config: ClientConfig): TermbookClient {
  return createTermbook(config);
}
