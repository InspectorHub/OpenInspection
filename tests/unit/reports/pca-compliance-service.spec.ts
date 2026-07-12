// tests/unit/reports/pca-compliance-service.spec.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComplianceService } from '../../../server/services/compliance/pca-compliance.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

// Same harness pattern as report-version-service.spec.ts: ComplianceService
// (like ReportVersionService and SigningKeyService) calls `drizzle(this.db)`
// internally, so mocking `drizzle-orm/d1`'s `drizzle` to return the
// in-memory better-sqlite3 db lets every internal call — including the
// SigningKeyService instance ComplianceService constructs for signing and
// verifying — share the same test database.
vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const SECRET = 'test-encryption-secret-32-bytes-long!!';

async function seedTenants(testDb: BetterSQLite3Database<typeof schema>) {
    // signing_keys.tenant_id has a FK to tenants(id) — ensureKeypair() (called
    // by every signOff/verifySignoff) requires the tenant row to exist first.
    await testDb.insert(schema.tenants).values([
        { id: 't1', name: 'Tenant One', slug: 't1', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        { id: 't2', name: 'Tenant Two', slug: 't2', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
    ]);
}

describe('ComplianceService (Phase M Task 5 — dual sign-off + PSQ + doc-review)', () => {
    let svc: ComplianceService;
    let testDb: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        await seedTenants(testDb);
        svc = new ComplianceService({} as D1Database, SECRET);
    });

    it('signs a reviewer attestation that verifies against the tenant key', async () => {
        const row = await svc.signOff('t1', 'insp1', {
            role: 'pcr_reviewer', personId: 'u1', name: 'Jane', license: 'PE-1', qualificationsRef: null, dualRole: false,
        });
        expect(row.signatureRef.length).toBeGreaterThan(0);
        expect(await svc.verifySignoff('t1', 'insp1', 'pcr_reviewer')).toBe(true);
    });

    it('one person, both roles → two rows, both dualRole, both verify', async () => {
        await svc.signOff('t1', 'insp1', { role: 'field_observer', personId: 'u1', name: 'Jane', license: 'PE-1', qualificationsRef: null, dualRole: true });
        await svc.signOff('t1', 'insp1', { role: 'pcr_reviewer', personId: 'u1', name: 'Jane', license: 'PE-1', qualificationsRef: null, dualRole: true });
        const { reportSignoffs } = await svc.getCompliance('t1', 'insp1');
        expect(reportSignoffs).toHaveLength(2);
        expect(reportSignoffs.every((r) => r.dualRole)).toBe(true);
        expect(await svc.verifySignoff('t1', 'insp1', 'field_observer')).toBe(true);
        expect(await svc.verifySignoff('t1', 'insp1', 'pcr_reviewer')).toBe(true);
    });

    it('re-signing the same role upserts (one row, new signature verifies)', async () => {
        const first = await svc.signOff('t1', 'insp1', { role: 'pcr_reviewer', personId: 'u1', name: 'Jane', license: 'PE-1', qualificationsRef: null, dualRole: false });
        const second = await svc.signOff('t1', 'insp1', { role: 'pcr_reviewer', personId: 'u1', name: 'Jane Updated', license: 'PE-1', qualificationsRef: null, dualRole: false });
        const { reportSignoffs } = await svc.getCompliance('t1', 'insp1');
        expect(reportSignoffs).toHaveLength(1);
        expect(second.signatureRef).not.toBe(first.signatureRef);
        expect(await svc.verifySignoff('t1', 'insp1', 'pcr_reviewer')).toBe(true);
    });

    it('removeSignOff deletes the row and verifySignoff returns false', async () => {
        await svc.signOff('t1', 'insp1', { role: 'pcr_reviewer', personId: 'u1', name: 'Jane', license: null, qualificationsRef: null, dualRole: false });
        await svc.removeSignOff('t1', 'insp1', 'pcr_reviewer');
        expect(await svc.verifySignoff('t1', 'insp1', 'pcr_reviewer')).toBe(false);
        const { reportSignoffs } = await svc.getCompliance('t1', 'insp1');
        expect(reportSignoffs).toHaveLength(0);
    });

    it('seedDocumentReview is idempotent', async () => {
        await svc.seedDocumentReview('t1', 'insp1');
        await svc.seedDocumentReview('t1', 'insp1');
        const { documentReview } = await svc.getCompliance('t1', 'insp1');
        const keys = documentReview.map((d) => d.documentKey);
        expect(new Set(keys).size).toBe(keys.length);
        expect(keys.length).toBeGreaterThan(0);
    });

    it('updateDocumentReviewItem patches a single seeded item', async () => {
        await svc.seedDocumentReview('t1', 'insp1');
        const { documentReview } = await svc.getCompliance('t1', 'insp1');
        const key = documentReview[0].documentKey;
        await svc.updateDocumentReviewItem('t1', 'insp1', key, { requested: true, received: true, reviewed: true });
        const after = await svc.getCompliance('t1', 'insp1');
        const item = after.documentReview.find((d) => d.documentKey === key);
        expect(item?.requested).toBe(true);
        expect(item?.received).toBe(true);
        expect(item?.reviewed).toBe(true);
    });

    it('upsertPsq stores responses and setPsqStatus transitions status', async () => {
        await svc.setPsqStatus('t1', 'insp1', 'sent');
        let { psq } = await svc.getCompliance('t1', 'insp1');
        expect(psq?.status).toBe('sent');

        await svc.upsertPsq('t1', 'insp1', { occupancy: 'owner', pendingRepairs: 'none' });
        ({ psq } = await svc.getCompliance('t1', 'insp1'));
        expect(psq?.status).toBe('received');
        expect(psq?.responses).toEqual({ occupancy: 'owner', pendingRepairs: 'none' });
    });

    it('scopes reads by tenant (no cross-tenant leak)', async () => {
        await svc.signOff('t1', 'insp1', { role: 'pcr_reviewer', personId: 'u1', name: 'Jane', license: null, qualificationsRef: null, dualRole: false });
        const { reportSignoffs } = await svc.getCompliance('t2', 'insp1');
        expect(reportSignoffs).toHaveLength(0);
    });
});
