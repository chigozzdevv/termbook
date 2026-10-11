"use client";

import { useCallback, useEffect, useState } from "react";
import { createPublicClient, http, parseAbi, formatUnits, zeroAddress, type Hex } from "viem";
import type { TermbookClient, CreditSummary } from "@termbook/sdk";
import { get } from "./data";

export type AccountView = CreditSummary & { mon: string; usdc: string; health: string | null };
const tokenAbi = parseAbi(["function balanceOf(address) view returns(uint256)"]);

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
          return { ...summary, mon: formatUnits(mon, 18), usdc: formatUnits(usdc, 6),
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
