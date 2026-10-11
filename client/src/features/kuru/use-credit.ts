"use client";

import { useCallback, useEffect, useState } from "react";
import { createPublicClient, http, parseAbi, formatUnits, zeroAddress, type Hex } from "viem";
import type { TermbookClient, CreditSummary } from "@termbook/sdk";
import { get } from "./data";

export type AccountView = CreditSummary & { mon: string; usdc: string; venueMon: string; venueUsdc: string;
  orders: { id: string; direction: "buy" | "sell"; remaining: string; filled: string; status: "open" | "partially filled" | "cancelling" }[]; health: string | null };
const tokenAbi = parseAbi(["function balanceOf(address) view returns(uint256)"]);
const custodyAbi = parseAbi(["function getBalance(address,address) view returns(uint256)"]);
const ordersAbi = parseAbi([
  "function count(bytes32) view returns(uint256)",
  "function at(bytes32,uint256) view returns(bytes32,(bytes32 positionId,uint256 committed,uint256 filled,uint256 refunded,uint256 remaining,uint256 liability,uint256 maxLiability,uint256 deadline,uint256 observedAt,uint8 positionSlots,address refundRecipient,uint8 status))",
  "function details(bytes32,bytes32) view returns(bytes32,address,uint256)",
]);

export function useCredit(client?: TermbookClient) {
  const [snapshot, setSnapshot] = useState<{ client: TermbookClient; rows: AccountView[]; error: string }>();
  const [selected, setSelected] = useState<string>();
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((n) => n + 1), []);
  useEffect(() => {
    if (!client) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const abort = new AbortController();
    const rpc = createPublicClient({ transport: http(client.config.rpcUrl) });
    async function poll() {
      try {
        const remote = await get(`/credits?borrower=${client!.signer.address()}`, AbortSignal.any([abort.signal, AbortSignal.timeout(20_000)]));
        if (!Array.isArray(remote)) throw new Error("Credit list unavailable");
        let saved: unknown = [];
        try { saved = JSON.parse(localStorage.getItem(`termbook:${client!.config.appToken}:${client!.signer.address().toLowerCase()}`) ?? "[]"); } catch {}
        const ids = [...new Set([...remote.map((row) => row?.creditId), ...(Array.isArray(saved) ? saved : [])])]
          .filter((id): id is Hex => typeof id === "string" && /^0x[a-fA-F0-9]{64}$/.test(id)).slice(-32);
        const block = await rpc.getBlock({ blockTag: "finalized" });
        const accounts = await Promise.all(ids.map(async (id): Promise<AccountView | undefined> => {
          const credit = client!.credit(id);
          const details = await credit.details();
          const borrower = Array.isArray(details) ? details[2] : details.borrower;
          const bundle = Array.isArray(details) ? details[20] : details.bundleId;
          if (String(borrower).toLowerCase() !== client!.signer.address().toLowerCase()
            || String(bundle).toLowerCase() !== client!.config.versionId?.toLowerCase()) return undefined;
          const summary = await credit.summary();
          let mon = 0n, usdc = 0n;
          if (summary.account && summary.account !== zeroAddress) [mon, usdc] = await Promise.all([
            rpc.getBalance({ address: summary.account, blockNumber: block.number }),
            rpc.readContract({ address: client!.config.settlementAsset!, abi: tokenAbi, functionName: "balanceOf", args: [summary.account], blockNumber: block.number }),
          ]);
          const health = await credit.account.health().catch(() => null);
          let venueMon = 0n, venueUsdc = 0n;
          const orders: AccountView["orders"] = [];
          const config = client!.config.integration_definition?.assessment?.orders;
          if (config && summary.account && summary.account !== zeroAddress) {
            const custody = config.rules[0]!.custody as Hex;
            [venueMon, venueUsdc] = await Promise.all([zeroAddress, client!.config.settlementAsset!].map((token) => rpc.readContract({
              address: custody, abi: custodyAbi, functionName: "getBalance", args: [summary.account!, token], blockNumber: block.number })));
            const count = await rpc.readContract({ address: config.tracker as Hex, abi: ordersAbi, functionName: "count", args: [id], blockNumber: block.number });
            if (count > 32n) throw new Error("Order list unavailable");
            for (let index = 0n; index < count; index++) {
              const [pendingId, state] = await rpc.readContract({ address: config.tracker as Hex, abi: ordersAbi, functionName: "at", args: [id, index], blockNumber: block.number });
              const [, token, venueId] = await rpc.readContract({ address: config.tracker as Hex, abi: ordersAbi, functionName: "details", args: [id, pendingId], blockNumber: block.number });
              const buy = token.toLowerCase() === client!.config.settlementAsset!.toLowerCase();
              orders.push({ id: String(venueId), direction: buy ? "buy" : "sell", remaining: formatUnits(state.remaining, buy ? 6 : 18),
                filled: formatUnits(state.filled, buy ? 6 : 18), status: state.status === 2 ? "cancelling" : state.filled > 0n ? "partially filled" : "open" });
            }
          }
          return { ...summary, mon: formatUnits(mon, 18), usdc: formatUnits(usdc, 6),
            venueMon: formatUnits(venueMon, 18), venueUsdc: formatUnits(venueUsdc, 6), orders,
            health: health?.value !== null && health?.value !== undefined ? (Number(health.value) / 100).toFixed(2) : null };
        }));
        if (active) setSnapshot({ client: client!, rows: accounts.filter((account): account is AccountView => !!account), error: "" });
      } catch {
        if (active) setSnapshot((prior) => ({ client: client!, rows: prior && prior.client === client ? prior.rows : [], error: "Credit Account balances could not be refreshed." }));
      }
      if (active) timer = setTimeout(poll, 10_000);
    }
    void poll();
    return () => { active = false; abort.abort(); clearTimeout(timer); };
  }, [client, revision]);
  const rows = client && snapshot?.client === client ? snapshot.rows : [];
  const account = rows.find((row) => row.id === selected) ?? rows.find((row) => row.facility === "ready") ?? rows.at(-1);
  return { rows, account, error: client && snapshot?.client === client ? snapshot.error : "", select: setSelected, refresh };
}
