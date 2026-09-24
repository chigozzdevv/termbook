import type { TermbookClient } from "../client/client.js";
import type { WithdrawArgs, HealthView } from "../types/account.types.js";
import type { TxHash } from "../types/client.types.js";

const risks = ["healthy", "watch", "frozen", "liquidatable"] as const;

export class CreditAccount {
  client: TermbookClient;
  creditId: `0x${string}`;

  constructor(client: TermbookClient, creditId: `0x${string}`) {
    this.client = client;
    this.creditId = creditId;
  }

  async withdraw(args: WithdrawArgs): Promise<{ tx: TxHash }> {
    if (args.amount <= 0n || !/^0x[a-fA-F0-9]{40}$/.test(args.asset)) throw new Error("param-invalid");
    await this.client.ready();
    const tx = await this.client.rpc.coreWrite("withdraw", [this.creditId, args.asset, this.client.signer.address(), args.amount]);
    await this.client.rpc.wait(tx);
    return { tx };
  }

  async health(): Promise<HealthView> {
    await this.client.ready();
    const debt = await this.client.rpc.debt(this.creditId);
    const riskAddress = this.client.config.riskEngine;
    if (!riskAddress) return { value: null, debt, state: debt === 0n ? "healthy" : "unknown" };
    const state = await this.client.rpc.riskState(riskAddress, this.creditId);
    const value = await this.client.rpc.riskHealth(riskAddress, this.creditId);
    return { value, debt, state: risks[state] ?? "unknown" };
  }

  async balances(): Promise<Record<string, bigint>> {
    await this.client.ready();
    const account = await this.client.rpc.account(this.creditId);
    if (!/^0x[a-fA-F0-9]{40}$/.test(account)) throw new Error("account-unavailable");
    const details = await this.client.rpc.creditDetails(this.creditId);
    const vault = Array.isArray(details) ? details[4] : details["vault"];
    if (typeof vault !== "string") return {};
    const asset = await this.client.rpc.read<`0x${string}`>(vault as `0x${string}`, [{ type: "function", name: "asset", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" }] as const, "asset");
    return { [asset]: await this.client.rpc.creditAccountTokenBalance(account, asset) };
  }
}
