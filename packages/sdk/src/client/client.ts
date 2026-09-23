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

export class TermbookClient {
  config: ResolvedClientConfig;
  rpc: RpcClient;
  signer: Signer;
  settlement: Settlement;

  constructor(config: ClientConfig) {
    const appToken = config.appToken ?? config.app_token;
    const rpcUrl = config.rpcUrl ?? config.rpc_url;
    const chainId = config.chainId ?? config.chain_id;
    if (!appToken || !config.core || !rpcUrl || !chainId || chainId <= 0) throw new Error("client-config-invalid");
    this.config = { ...config, appToken, core: config.core, rpcUrl, chainId };
    this.rpc = new RpcClient(this.config);
    this.signer = new Signer(config.wallet);
    this.settlement = new Settlement(this);
  }

  intent(req: IntentRequest): Intent {
    return new Intent(this, req);
  }

  open(req?: IntentRequest): Intent {
    return new Intent(this, req);
  }

  credit(id: `0x${string}`): Credit {
    return new Credit(this, id);
  }

  collateral_setup(binding: CollateralSetupBinding | string, options: CollateralSetupOptions = {}): CollateralSetup {
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

  async authenticatedPost<T>(path: string, body: unknown): Promise<T> {
    if (!this.config.apiBase) throw new Error("api-required");
    if (!this.config.wallet.signMessage) throw new Error("wallet-message-signing-unavailable");
    const http = new HttpClient(this.config.apiBase);
    const challenge = await http.post<{ message: string }>("/auth/nonce", { wallet: this.signer.address() });
    const signature = await this.config.wallet.signMessage(challenge.message);
    return http.post<T>(path, body, {
      "x-termbook-wallet": this.signer.address(),
      "x-termbook-signature": signature,
    });
  }
}

export function createTermbook(config: ClientConfig): TermbookClient {
  return new TermbookClient(config);
}

export function create_termbook(config: ClientConfig): TermbookClient {
  return createTermbook(config);
}
