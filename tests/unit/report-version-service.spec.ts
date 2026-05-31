import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReportVersionService } from '../../server/services/report-version.service';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT     = '00000000-0000-0000-0000-000000000099';
const INSPECTION = '11111111-1111-1111-1111-111111111111';

async function seed(testDb: BetterSQLite3Database<typeof schema>) {
    await testDb.insert(schema.tenants).values({
        id: TENANT, name: 'Acme', subdomain: 'acme', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    await testDb.insert(schema.inspections).values({
        id: INSPECTION, tenantId: TENANT,
        propertyAddress: '1 Main St', date: '2026-06-01',
        status: 'draft', paymentStatus: 'unpaid', price: 0,
        paymentRequired: false, agreementRequired: false, createdAt: new Date(),
    });
}

describe('ReportVersionService (subsystem D P7 T7.2)', () => {
    let svc: ReportVersionService;
    let testDb: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        await seed(testDb);
        svc = new ReportVersionService({} as D1Database);
    });

    it('snapshotOnPublish writes version 1', async () => {
        const out = await svc.snapshotOnPublish(TENANT, INSPECTION, 'user-a');
        expect(out.versionNumber).toBe(1);
    });

    it('second publish increments to 2', async () => {
        await svc.snapshotOnPublish(TENANT, INSPECTION, 'user-a');
        const out = await svc.snapshotOnPublish(TENANT, INSPECTION, 'user-a', 'fixed typos');
        expect(out.versionNumber).toBe(2);
        expect(out.summary).toBe('fixed typos');
    });

    it('list returns versions descending', async () => {
        await svc.snapshotOnPublish(TENANT, INSPECTION, 'user-a');
        await svc.snapshotOnPublish(TENANT, INSPECTION, 'user-a');
        const list = await svc.list(TENANT, INSPECTION);
        expect(list.map(v => v.versionNumber)).toEqual([2, 1]);
    });

    it('get returns the snapshot for a specific version', async () => {
        await svc.snapshotOnPublish(TENANT, INSPECTION, 'user-a');
        const snap = await svc.get(TENANT, INSPECTION, 1);
        expect(snap).not.toBeNull();
        expect(snap?.inspection?.id).toBe(INSPECTION);
    });

    it('get returns null for missing version', async () => {
        const snap = await svc.get(TENANT, INSPECTION, 99);
        expect(snap).toBeNull();
    });

    it('diff returns null when either version is missing', async () => {
        await svc.snapshotOnPublish(TENANT, INSPECTION, 'user-a');
        expect(await svc.diff(TENANT, INSPECTION, 1, 99)).toBeNull();
    });

    it('snapshotOnPublish throws for unknown inspection', async () => {
        await expect(svc.snapshotOnPublish(TENANT, 'no-such-id', 'user-a')).rejects.toThrow(/not found/i);
    });

    it('snapshotOnPublish is tenant-scoped (foreign tenant treated as not_found)', async () => {
        await expect(svc.snapshotOnPublish('other-tenant', INSPECTION, 'user-a')).rejects.toThrow(/not found/i);
    });
});
