import { HttpError } from "../http/http.errors.js";
import { explorerRepo } from "./explorer.repo.js";
import { requireSnapshot, snapshotRepo } from "./snapshot.repo.js";

async function snapshot(generation?: string) {
  const cursor = await explorerRepo.cursor();
  if (!cursor || cursor.integrityFailure) throw new HttpError(503, "explorer-index-unavailable");
  return requireSnapshot(generation);
}
export const explorerService = {
  async houses() { return snapshotRepo.houses(await snapshot()); },
  async house(id: string) { return snapshotRepo.house(await snapshot(), id); },
  async orders(cursor?: string, generation?: string) { return snapshotRepo.orders(await snapshot(generation), cursor); },
  async order(id: string) { return snapshotRepo.order(await snapshot(), id); },
};
