import { createPublicClient, http, type PublicClient } from "viem";
import type { ActivityEvent, ResolvedClientConfig, ContractWriteRequest, TxHash } from "../types/client.types.js";
import {
  collateralVaultAbi,
  creditAccountAbi,
  houseVaultAbi,
  riskEngineAbi,
  settlementInboxAbi,
  termbookCoreAbi,
} from "@termbook/bindings";

const erc20Abi = [
  { type: "function", name: "balanceOf", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "approve", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }], stateMutability: "nonpayable" },
] as const;

export class RpcClient {
  config: ResolvedClientConfig;
  client: PublicClient;

  constructor(config: ResolvedClientConfig) {
    this.config = config;
    this.client = createPublicClient({ transport: http(config.rpcUrl) });
  }

  async read<T>(address: `0x${string}`, abi: readonly unknown[], functionName: string, args: readonly unknown[] = []): Promise<T> {
    return this.client.readContract({ address, abi, functionName, args } as never) as Promise<T>;
  }

  async write(address: `0x${string}`, abi: readonly unknown[], functionName: string, args: readonly unknown[] = [], value?: bigint): Promise<TxHash> {
    const writer = this.config.wallet.writeContract;
    if (!writer) throw new Error("wallet-write-unavailable");
    const rpcChainId = await this.client.getChainId();
    if (rpcChainId !== this.config.chainId) throw new Error("chain-mismatch");
    const request: ContractWriteRequest = { address, abi, functionName, args, account: this.config.wallet.address };
    if (value !== undefined) request.value = value;
    return writer(request);
  }

  async wait(hash: TxHash): Promise<unknown> {
    const confirmations = this.config.confirmations ?? 1;
    if (!Number.isSafeInteger(confirmations) || confirmations < 1) throw new Error("confirmations-invalid");
    const receipt = await this.client.waitForTransactionReceipt({ hash, confirmations });
    if (receipt.status !== "success") throw new Error("transaction-reverted");
    return receipt;
  }

  async debt(creditId: `0x${string}`): Promise<bigint> {
    return this.read<bigint>(this.config.core, termbookCoreAbi, "creditDebt", [creditId]);
  }

  async facility(creditId: `0x${string}`): Promise<number> {
    const value = await this.read<bigint | number>(this.config.core, termbookCoreAbi, "creditFacility", [creditId]);
    return Number(value);
  }

  async revision(creditId: `0x${string}`): Promise<bigint> {
    const value = await this.read<bigint | number>(this.config.core, termbookCoreAbi, "creditRevision", [creditId]);
    return typeof value === "bigint" ? value : BigInt(value);
  }

  async account(creditId: `0x${string}`): Promise<`0x${string}`> {
    return this.read<`0x${string}`>(this.config.core, termbookCoreAbi, "creditAccount", [creditId]);
  }

  async domain(): Promise<`0x${string}`> {
    return this.read<`0x${string}`>(this.config.core, termbookCoreAbi, "domain");
  }

  async creditDetails(creditId: `0x${string}`): Promise<Record<string, unknown>> {
    return this.read<Record<string, unknown>>(this.config.core, termbookCoreAbi, "creditDetails", [creditId]);
  }

  async coreWrite(functionName: string, args: readonly unknown[] = []): Promise<TxHash> {
    return this.write(this.config.core, termbookCoreAbi, functionName, args);
  }

  async tokenBalance(token: `0x${string}`, account: `0x${string}`): Promise<bigint> {
    return this.read<bigint>(token, erc20Abi, "balanceOf", [account]);
  }

  async approve(token: `0x${string}`, spender: `0x${string}`, amount: bigint): Promise<TxHash> {
    return this.write(token, erc20Abi, "approve", [spender, amount]);
  }

  async vaultSharePrice(vault: `0x${string}`): Promise<bigint> {
    return this.read<bigint>(vault, houseVaultAbi, "sharePrice");
  }

  async vaultShares(vault: `0x${string}`, owner: `0x${string}`): Promise<bigint> {
    return this.read<bigint>(vault, houseVaultAbi, "shares", [owner]);
  }

  async collateralConsumed(vault: `0x${string}`, lockId: `0x${string}`): Promise<boolean> {
    return this.read<boolean>(vault, collateralVaultAbi, "consumed", [lockId]);
  }

  async inboxStatus(inbox: `0x${string}`): Promise<{ received: bigint; applied: bigint; refunded: bigint }> {
    const [received, applied, refunded] = await Promise.all([
      this.read<bigint>(inbox, settlementInboxAbi, "received"),
      this.read<bigint>(inbox, settlementInboxAbi, "applied"),
      this.read<bigint>(inbox, settlementInboxAbi, "refunded"),
    ]);
    return { received, applied, refunded };
  }

  async creditAccountTokenBalance(account: `0x${string}`, token: `0x${string}`): Promise<bigint> {
    return this.read<bigint>(account, creditAccountAbi, "tokenBalance", [token]);
  }

  async riskState(risk: `0x${string}`, creditId: `0x${string}`): Promise<number> {
    const value = await this.read<bigint | number>(risk, riskEngineAbi, "riskState", [creditId]);
    return Number(value);
  }

  async riskHealth(risk: `0x${string}`, creditId: `0x${string}`): Promise<bigint> {
    const value = await this.read<bigint | number>(risk, riskEngineAbi, "health", [creditId]);
    return typeof value === "bigint" ? value : BigInt(value);
  }

  async riskSnapshot(risk: `0x${string}`, creditId: `0x${string}`): Promise<Record<string, unknown>> {
    return this.read<Record<string, unknown>>(risk, riskEngineAbi, "snapshot", [creditId]);
  }

  async activity(address: `0x${string}`, abi: readonly unknown[], eventNames: readonly string[], args?: Record<string, unknown>): Promise<ActivityEvent[]> {
    const logs = await Promise.all(eventNames.map(async (eventName) => {
      const rows = await this.client.getLogs({ address, abi, eventName, args } as never) as readonly Record<string, unknown>[];
      return rows.map((row) => ({
        event: eventName,
        blockNumber: typeof row["blockNumber"] === "bigint" ? row["blockNumber"] as bigint : undefined,
        transactionHash: typeof row["transactionHash"] === "string" ? row["transactionHash"] as TxHash : undefined,
        logIndex: typeof row["logIndex"] === "bigint" ? row["logIndex"] as bigint : undefined,
        args: (row["args"] && typeof row["args"] === "object" ? row["args"] : {}) as Record<string, unknown>,
      }));
    }));
    return logs.flat().sort((a, b) => {
      const block = (a.blockNumber ?? 0n) - (b.blockNumber ?? 0n);
      if (block !== 0n) return block < 0n ? -1 : 1;
      return Number((a.logIndex ?? 0n) - (b.logIndex ?? 0n));
    });
  }

  async creditActivity(creditId: `0x${string}`): Promise<ActivityEvent[]> {
    return this.activity(this.config.core, termbookCoreAbi, [
      "CreditCreated", "CreditReady", "CreditAborted", "Drawn", "Repaid", "Closed",
      "LiquidationStarted", "Cured", "Liquidated", "CollateralBound", "CollateralReturned", "RemoteReturnRequested",
    ], { creditId });
  }

  async houseActivity(vault: `0x${string}`): Promise<ActivityEvent[]> {
    return this.activity(vault, houseVaultAbi, [
      "Deposited", "Withdrawn", "Reserved", "Released", "DrawFunded", "RepaymentReceived", "SettlementInboxSet",
      "ImpairmentRecognized", "WithdrawalQueued", "WithdrawalClaimed", "WithdrawalCancelled",
    ]);
  }
}
