import type { TermbookClient } from "../client/client.js";
import type { ReceiptView } from "./receipt.js";
import type { OperationKind } from "./operation.js";
import { operationId } from "./operation.js";

export class Settlement {
  client: TermbookClient;

  constructor(client: TermbookClient) {
    this.client = client;
  }

  async inboxStatus(inbox: `0x${string}`): Promise<ReceiptView> {
    if (!/^0x[a-fA-F0-9]{40}$/.test(inbox)) throw new Error("param-invalid");
    return this.client.rpc.inboxStatus(inbox);
  }

  async register(input: {
    kind: OperationKind;
    payer: `0x${string}`;
    nonce: bigint;
    chainId: number;
    creditId?: `0x${string}`;
    routeVersion?: `0x${string}`;
    asset: `0x${string}`;
    settlementAsset: `0x${string}`;
    vault: `0x${string}`;
    maxAmountIn: bigint;
    minAmountOut: bigint;
    deadline: number;
    sourceRefund: `0x${string}`;
    monadRefund: `0x${string}`;
  }): Promise<`0x${string}`> {
    const id = operationId({ kind: input.kind, payer: input.payer, nonce: input.nonce, chainId: input.chainId, creditId: input.creditId, routeVersion: input.routeVersion, asset: input.asset, vault: input.vault });
    const result = await this.client.authenticatedPost<{ operationId?: string; operation_id?: string }>("/settlement", {
      operationId: id,
      kind: input.kind,
      nonce: input.nonce.toString(),
      sourceChain: input.chainId,
      sourceAsset: input.asset,
      token: input.settlementAsset,
      maxAmountIn: input.maxAmountIn.toString(),
      minAmountOut: input.minAmountOut.toString(),
      vault: input.vault,
      creditId: input.creditId,
      payer: input.payer,
      deadline: input.deadline,
      refundRecipient: input.monadRefund,
      sourceRefundRecipient: input.sourceRefund,
      monadRefundRecipient: input.monadRefund,
      routeVersion: input.routeVersion,
    });
    const saved = result.operationId ?? result.operation_id;
    if (!saved || !/^0x[a-fA-F0-9]{64}$/.test(saved)) throw new Error("settlement-invalid");
    return saved as `0x${string}`;
  }
}
