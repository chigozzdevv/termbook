import { beforeEach, describe, expect, it, vi } from 'vitest';
import { riskRepo } from '../../src/risk/risk.repo.js';
import { riskScanConfig } from '../../src/risk/risk.config.js';
const mocks = vi.hoisted(() => ({ update: vi.fn(), claim: vi.fn(), scans: vi.fn(), count: vi.fn(), rows: vi.fn(), find: vi.fn() }));
vi.mock('../../src/risk/risk.model.js', () => ({ RiskModel: {}, RiskScanModel: {
  updateOne: mocks.update, findOneAndUpdate: (...args: unknown[]) => ({ lean: () => mocks.claim(...args) }),
  find: () => ({ select: () => ({ lean: mocks.scans }) }),
} }));
vi.mock('../../src/credit/credit.model.js', () => ({ CreditModel: { countDocuments: mocks.count,
  find: (...args: unknown[]) => { mocks.find(...args); return { sort: () => ({ limit: () => ({ select: () => ({ lean: mocks.rows }) }) }) }; },
} }));
beforeEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); mocks.update.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }); mocks.claim.mockResolvedValue({ after: '' }); });
describe('leased credit scans', () => {
  it('partitions all credit IDs without overlap and acquires one fenced cursor', async () => {
    const low = await riskRepo.claim('network', 0, 2), high = await riskRepo.claim('network', 1, 2);
    expect(low?.upper).toBe(high?.lower); expect(low?.lower).toBe(`0x${'0'.repeat(64)}`); expect(high?.upper).toBeNull();
    expect(mocks.claim).toHaveBeenCalledWith(expect.objectContaining({ _id: 'network:scan:2:1', $or: expect.any(Array) }),
      expect.objectContaining({ $set: expect.objectContaining({ lease: high?.lease }) }), { returnDocument: "after" });
    mocks.claim.mockResolvedValue(null); expect(await riskRepo.claim('network', 0, 2)).toBeNull();
  });
  it('restricts each page to its shard and cursor and prevents stale workers from advancing', async () => {
    mocks.rows.mockResolvedValue([{ creditId: 'id' }]);
    await expect(riskRepo.page({ lower: 'lower', upper: 'upper', after: 'after' }, 128)).resolves.toEqual(['id']);
    expect(mocks.find).toHaveBeenCalledWith(expect.objectContaining({ creditId: { $gte: 'lower', $lt: 'upper', $gt: 'after' } }));
    mocks.update.mockResolvedValue({ modifiedCount: 0 });
    await expect(riskRepo.advance({ id: 'scan', lease: 'expired' }, 'id', '100', false)).rejects.toThrow('risk-scan-lease-lost');
    expect(mocks.update).toHaveBeenLastCalledWith(expect.objectContaining({ lease: 'expired', leaseUntil: expect.anything() }), expect.anything());
  });
  it('records complete cycles and makes missing or stale monitoring unready', async () => {
    await riskRepo.advance({ id: 'scan', lease: 'lease' }, 'last', '100', true);
    expect(mocks.update).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ $inc: { cycles: 1 }, $set: expect.objectContaining({ after: '', cycleCompletedAt: expect.any(Date) }) }));
    mocks.count.mockResolvedValue(1); mocks.scans.mockResolvedValue([]);
    expect(await riskRepo.scanHealthy('network', 1, 120000)).toBe(false);
    mocks.scans.mockResolvedValue([{ cycleCompletedAt: new Date(), processedAt: new Date() }]); expect(await riskRepo.scanHealthy('network', 1, 120000)).toBe(true);
    mocks.scans.mockResolvedValue([{ cycleCompletedAt: new Date(0), processedAt: new Date() }]); expect(await riskRepo.scanHealthy('network', 1, 120000)).toBe(false);
    mocks.count.mockResolvedValue(0); expect(await riskRepo.scanHealthy('network', 1, 120000)).toBe(true);
  });
  it('rejects invalid concurrency, page budgets and shard configuration', () => {
    vi.stubEnv('RISK_SCAN_SHARDS', '3'); expect(riskScanConfig).toThrow('risk-scan-config-invalid');
    vi.stubEnv('RISK_SCAN_SHARDS', '2'); vi.stubEnv('RISK_SCAN_CONCURRENCY', '33'); expect(riskScanConfig).toThrow('risk-scan-config-invalid');
    vi.stubEnv('RISK_SCAN_CONCURRENCY', '8'); expect(riskScanConfig()).toMatchObject({ shards: 2, concurrency: 8 });
    vi.unstubAllEnvs();
  });
});
