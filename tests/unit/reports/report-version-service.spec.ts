import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReportVersionService } from '../../../server/services/report-version.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq as schema_eq } from 'drizzle-orm';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT     = '00000000-0000-0000-0000-000000000099';
const INSPECTION = '11111111-1111-1111-1111-111111111111';

async function seed(testDb: BetterSQLite3Database<typeof schema>) {
    await testDb.insert(schema.tenants).values({
        id: TENANT, name: 'Acme', slug: 'acme', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    await testDb.insert(schema.inspections).values({
        id: INSPECTION, tenantId: TENANT,
        propertyAddress: '1 Main St', date: '2026-06-01',
        status: 'requested', paymentStatus: 'unpaid', price: 0,
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
        svc = new ReportVersionService({} as D1Database, 'test-encryption-secret-key');
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

    it('v1 signs content, has null prev_hash, is not an amendment', async () => {
        const out = await svc.snapshotOnPublish(TENANT, INSPECTION, 'user-a');
        const row = await testDb.select().from(schema.reportVersions)
            .where(schema_eq(schema.reportVersions.versionNumber, 1)).get();
        expect(row?.contentHash).toMatch(/^[0-9a-f]{64}$/);
        expect(row?.prevHash).toBeNull();
        expect(row?.isAmendment).toBe(false);
        expect(row?.signature).toBeTruthy();
        expect(row?.keyFingerprint).toBeTruthy();
        expect(row?.verificationToken).toBeTruthy();
        expect(out.versionNumber).toBe(1);
    });

    it('v2 chains prev_hash to v1 content_hash and is an amendment', async () => {
        await svc.snapshotOnPublish(TENANT, INSPECTION, 'user-a');
        await svc.snapshotOnPublish(TENANT, INSPECTION, 'user-a', 'corrected roof note');
        const rows = await testDb.select().from(schema.reportVersions).all();
        const v1 = rows.find(r => r.versionNumber === 1)!;
        const v2 = rows.find(r => r.versionNumber === 2)!;
        expect(v2.prevHash).toBe(v1.contentHash);
        expect(v2.isAmendment).toBe(true);
        expect(v2.summary).toBe('corrected roof note');
    });

    it('verifyByToken validates an untampered version (hash + signature + chain)', async () => {
        await svc.snapshotOnPublish(TENANT, INSPECTION, 'user-a');
        const row = await testDb.select().from(schema.reportVersions).get();
        const res = await svc.verifyByToken(row!.verificationToken!);
        expect(res).not.toBeNull();
        expect(res!.hashValid).toBe(true);
        expect(res!.signatureValid).toBe(true);
        expect(res!.chainValid).toBe(true);
        expect(res!.versionNumber).toBe(1);
        expect(res!.isAmendment).toBe(false);
    });

    it('verifyByToken detects a tampered snapshot (hash mismatch)', async () => {
        await svc.snapshotOnPublish(TENANT, INSPECTION, 'user-a');
        const row = await testDb.select().from(schema.reportVersions).get();
        await testDb.update(schema.reportVersions)
            .set({ snapshotJson: '{"inspection":{"id":"hacked"},"data":{},"units":[]}' })
            .where(schema_eq(schema.reportVersions.id, row!.id));
        const res = await svc.verifyByToken(row!.verificationToken!);
        expect(res!.hashValid).toBe(false);
        expect(res!.signatureValid).toBe(false);
    });

    it('verifyByToken returns null for an unknown token', async () => {
        expect(await svc.verifyByToken('no-such-token')).toBeNull();
    });
});
