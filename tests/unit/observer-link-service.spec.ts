import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ObserverLinkService } from '../../server/services/observer-link.service';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-000000000099';
const INSPECTION = '11111111-1111-1111-1111-111111111111';

async function seed(testDb: BetterSQLite3Database<typeof schema>) {
    await testDb.insert(schema.tenants).values({
        id: TENANT, name: 'Acme', slug: 'acme', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    await testDb.insert(schema.inspections).values({
        id: INSPECTION, tenantId: TENANT,
        propertyAddress: '1 Main St', date: '2026-06-01',
        status: 'draft', paymentStatus: 'unpaid', price: 0,
        paymentRequired: false, agreementRequired: false, createdAt: new Date(),
    });
}

describe('ObserverLinkService (subsystem D P4 T4.3)', () => {
    let svc: ObserverLinkService;
    let testDb: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        await seed(testDb);
        svc = new ObserverLinkService({} as D1Database);
    });

    it('mint returns token + expiresAt in the future', async () => {
        const out = await svc.mint(TENANT, { inspectionId: INSPECTION, createdBy: 'user-a' });
        expect(out.token).toMatch(/^[A-Za-z0-9_-]{20,}$/);
        expect(out.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });

    it('claim returns ok for an active token', async () => {
        const minted = await svc.mint(TENANT, { inspectionId: INSPECTION, createdBy: 'user-a' });
        const out = await svc.claim(minted.token);
        expect(out.kind).toBe('ok');
        if (out.kind === 'ok') {
            expect(out.inspectionId).toBe(INSPECTION);
            expect(out.tenantId).toBe(TENANT);
        }
    });

    it('claim returns not_found for unknown token', async () => {
        const out = await svc.claim('not-a-real-token');
        expect(out.kind).toBe('not_found');
    });

    it('claim returns expired when expiresAt has passed', async () => {
        const minted = await svc.mint(TENANT, { inspectionId: INSPECTION, createdBy: 'user-a', durationSeconds: -1 });
        const out = await svc.claim(minted.token);
        expect(out.kind).toBe('expired');
    });

    it('revoke causes subsequent claim to return revoked', async () => {
        const minted = await svc.mint(TENANT, { inspectionId: INSPECTION, createdBy: 'user-a' });
        await svc.revoke(TENANT, minted.id);
        const out = await svc.claim(minted.token);
        expect(out.kind).toBe('revoked');
    });

    it('list returns links for the matching inspection only', async () => {
        await svc.mint(TENANT, { inspectionId: INSPECTION, createdBy: 'user-a' });
        await svc.mint(TENANT, { inspectionId: INSPECTION, createdBy: 'user-a' });
        const list = await svc.list(TENANT, INSPECTION);
        expect(list).toHaveLength(2);
    });

    it('revoke is tenant-scoped — cannot touch another tenant\'s link', async () => {
        const minted = await svc.mint(TENANT, { inspectionId: INSPECTION, createdBy: 'user-a' });
        // Wrong tenant: no-op (no row updated)
        await svc.revoke('other-tenant', minted.id);
        const stillOk = await svc.claim(minted.token);
        expect(stillOk.kind).toBe('ok');
    });
});
