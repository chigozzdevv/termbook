import { explorerReader } from "./explorer.reader.js";
import { explorerRepo } from "./explorer.repo.js";
import { snapshotRepo } from "./snapshot.repo.js";

export async function runExplorerWorker(): Promise<number> {
  const lease = await snapshotRepo.claim();
  if (!lease) return 0;
  let lost = false;
  const heartbeat = setInterval(() => { void snapshotRepo.renew(lease).then((valid) => { lost ||= !valid; }).catch(() => { lost = true; }); }, 30_000);
  try {
    const previous = await snapshotRepo.current();
    const indexed = await explorerRepo.cursor();
    if (!indexed || indexed.integrityFailure) throw new Error("explorer-index-unavailable");
    if (previous && Date.now() - previous.publishedAt.getTime() < 30_000
      && (previous.eventRevision ?? "") === (indexed.eventRevision ?? "")) return 0;
    const publication = await explorerReader.snapshot(previous ? { version: previous.version, orders: await snapshotRepo.priorOrders(previous) } : undefined);
    const cursor = await explorerRepo.cursor();
    if (lost || !cursor || cursor.integrityFailure) throw new Error("explorer-snapshot-integrity-unavailable");
    await snapshotRepo.publish(publication, lease);
    return publication.orders.length + publication.houses.length;
  } finally { clearInterval(heartbeat); await snapshotRepo.release(lease); }
}
