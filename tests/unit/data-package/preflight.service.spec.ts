/**
 * Import preflight service tests (J2b). Preflight is read-only: it inspects the
 * declared package metadata against the target workspace and decides ok/blocked,
 * estimates D1 writes and days, and asks the owner about things the server
 * cannot detect (paid plan, CPU budget). Nothing is applied here.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../db';
import { asScopedDbSource } from '../helpers/test-db';
import { DataPackagePreflightService, type PreflightInput } from '../../../server/services/data-package/preflight.service';
import { schemaFingerprint } from '../../../server/lib/data-package/fingerprint';
import { tenants, inspections } from '../../../server/lib/db/schema';
import { NO_STARTER_CONTENT } from '../../../server/services/starter-content/content-version';

const TENANT = 'tenant-target';
const SOURCE = 'tenant-source';
const profile = {
    fixedTenantId: SOURCE, // keep-ids precondition: target configured id == source
    importMaxRows: 1_000,
    hasBilling: false,
    hasUsageQuota: false,
};

describe('DataPackagePreflightService', () => {
    let db: any;
    let svc: DataPackagePreflightService;
    let currentFp: string;

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db;
        svc = new DataPackagePreflightService(asScopedDbSource(setup.db as any), {
            now: () => 1_700_000_000_000,
            profile,
            schemaFingerprint: () => schemaFingerprint(),
        });
        currentFp = await schemaFingerprint();
        await db.insert(tenants).values([
            { id: TENANT, slug: 'target', createdAt: new Date(1_700_000_000_000), contentVersion: NO_STARTER_CONTENT },
            { id: 'another-tenant', slug: 'other', createdAt: new Date(1_700_000_000_000) },
        ]);
        // A row belonging to another tenant must not make this target non-blank.
        await db.insert(inspections).values({
            id: 'other-row', tenantId: 'another-tenant', propertyAddress: 'x',
            status: 'scheduled', date: '2026-01-01', createdAt: new Date(1_700_000_000_000),
        } as never);
    });

    const baseInput = (over: Partial<PreflightInput> = {}): PreflightInput => ({
        formatVersion: 1,
        columnFingerprint: currentFp,
        schemaVersion: '0013_import_id_map',
        sourceTenantId: SOURCE,
        sourceMode: 'standalone',
        counts: { inspections: 10, contacts: 5 },
        ...over,
    });

    it('approves a current-format, known-fingerprint package against a blank target', async () => {
        const r = await svc.run(TENANT, baseInput());
        expect(r.ok).toBe(true);
        expect(r.reasons).toEqual([]);
        expect(r.keepIds).toBe(true);
    });

    it('blocks a package newer than the target', async () => {
        const r = await svc.run(TENANT, baseInput({ formatVersion: 2 }));
        expect(r.ok).toBe(false);
        expect(r.reasons.join(' ')).toMatch(/newer/i);
    });

    it('blocks an unknown fingerprint unless the operator accepts lenient mode', async () => {
        const r = await svc.run(TENANT, baseInput({ columnFingerprint: 'f'.repeat(64) }));
        expect(r.ok).toBe(false);
        expect(r.reasons.join(' ')).toMatch(/fingerprint|unknown shape/i);
        const lenient = await svc.run(TENANT, baseInput({ columnFingerprint: 'f'.repeat(64), lenient: true }));
        expect(lenient.ok).toBe(true);
        expect(lenient.reasons.join(' ')).toMatch(/lenient/i);
    });

    it('does not offer keep-ids when the target is non-blank or its configured id differs', async () => {
        await db.insert(inspections).values({
            id: 'target-data', tenantId: TENANT, propertyAddress: 'y',
            status: 'scheduled', date: '2026-01-01', createdAt: new Date(1_700_000_000_000),
        } as never);
        const nonBlank = await svc.run(TENANT, baseInput());
        expect(nonBlank.ok).toBe(true);
        expect(nonBlank.keepIds).toBe(false);

        await db.delete(inspections).where(eq(inspections.tenantId, TENANT)).run();
        const diffSvc = new DataPackagePreflightService(asScopedDbSource(db), {
            now: () => 1_700_000_000_000,
            profile: { ...profile, fixedTenantId: 'different-id' },
            schemaFingerprint: () => schemaFingerprint(),
        });
        expect((await diffSvc.run(TENANT, baseInput())).keepIds).toBe(false);
    });

    it('estimates rows, D1 writes and days from the declared counts', async () => {
        const r = await svc.run(TENANT, baseInput());
        expect(r.estimate.rows).toBe(15);
        expect(r.estimate.writes).toBeGreaterThan(15); // ~6 writes per imported row
        expect(r.estimate.days).toBeGreaterThanOrEqual(1);
    });

    it('blocks a package over the target import row cap', async () => {
        const r = await svc.run(TENANT, baseInput({ counts: { inspections: 5000 } }));
        expect(r.ok).toBe(false);
        expect(r.reasons.join(' ')).toMatch(/cap|rows/i);
    });

    it('asks about server-undetectable items and echoes the answers', async () => {
        const r = await svc.run(TENANT, baseInput());
        expect(r.questions.map((q) => q.id)).toContain('paid_plan');
        const answered = await svc.run(TENANT, baseInput({ answers: { paid_plan: 'yes' } }));
        expect(answered.answers.paid_plan).toBe('yes');
    });
});
