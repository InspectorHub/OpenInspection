import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PortalService } from '../../../server/services/portal.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

// PortalService builds its drizzle handle via `drizzle(this.db)` (drizzle-orm/d1).
// Mock that factory to hand back the in-memory better-sqlite3 test DB, mirroring
// the harness used by portal-access.spec.ts.
vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

import { TENANT, inspStub, seedInspection, seedToken } from '../helpers/portal-routes-setup';

describe('PortalService', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let svc: PortalService;

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        await testDb.insert(schema.tenants).values({
            id: TENANT, name: 'Acme', slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        svc = new PortalService({} as D1Database, inspStub);
    });

    it('listRecipientInspections returns only this email + client/co_client roles, dedup, excludes revoked', async () => {
        for (const id of ['insp1', 'insp2', 'insp3', 'insp4', 'insp5']) await seedInspection(testDb, id);
        await seedToken(testDb, 'insp1', 'a@x.com', 'client');
        await seedToken(testDb, 'insp2', 'a@x.com', 'co_client');
        await seedToken(testDb, 'insp3', 'a@x.com', 'agent');       // excluded — agent role
        await seedToken(testDb, 'insp4', 'b@x.com', 'client');      // excluded — other email
        await seedToken(testDb, 'insp5', 'a@x.com', 'client', 1);   // excluded — revoked

        const rows = await svc.listRecipientInspections(TENANT, 'a@x.com');
        const ids = rows.map((r) => r.inspectionId).sort();
        expect(ids).toEqual(['insp1', 'insp2']);
    });

    it('listRecipientInspections enforces expiresAt: excludes past-expiry, includes future-expiry and null-expiry', async () => {
        for (const id of ['inspNull', 'inspFuture', 'inspPast']) await seedInspection(testDb, id);
        const past = Date.now() - 60_000;   // expired one minute ago
        const future = Date.now() + 60_000; // expires one minute from now
        await seedToken(testDb, 'inspNull', 'a@x.com', 'client', null, null);     // never expires → included
        await seedToken(testDb, 'inspFuture', 'a@x.com', 'client', null, future); // not yet expired → included
        await seedToken(testDb, 'inspPast', 'a@x.com', 'client', null, past);     // expired → excluded

        const rows = await svc.listRecipientInspections(TENANT, 'a@x.com');
        const ids = rows.map((r) => r.inspectionId).sort();
        expect(ids).toEqual(['inspFuture', 'inspNull']);
    });

    it('listRecipientInspections returns [] when the recipient has no live tokens', async () => {
        await seedInspection(testDb, 'insp1');
        await seedToken(testDb, 'insp1', 'someone@x.com', 'client');
        expect(await svc.listRecipientInspections(TENANT, 'nobody@x.com')).toEqual([]);
    });

    it('hubOverview returns the 6 status dimensions', async () => {
        await seedInspection(testDb, 'insp1', { reportStatus: 'published', paymentStatus: 'paid' });
        const agreementId = crypto.randomUUID();
        await testDb.insert(schema.agreements).values({
            id: agreementId, tenantId: TENANT, name: 'A', content: 'terms', createdAt: new Date(),
        });
        await testDb.insert(schema.agreementRequests).values({
            id: crypto.randomUUID(), tenantId: TENANT, inspectionId: 'insp1',
            agreementId, clientEmail: 'a@x.com',
            token: crypto.randomUUID(), status: 'signed', createdAt: new Date(),
        });
        await testDb.insert(schema.inspectionMessages).values([
            { id: crypto.randomUUID(), tenantId: TENANT, inspectionId: 'insp1', fromRole: 'inspector', body: 'hi', readAt: null, createdAt: Date.now() },
            { id: crypto.randomUUID(), tenantId: TENANT, inspectionId: 'insp1', fromRole: 'inspector', body: 'read', readAt: Date.now(), createdAt: Date.now() },
            { id: crypto.randomUUID(), tenantId: TENANT, inspectionId: 'insp1', fromRole: 'client', body: 'mine', readAt: null, createdAt: Date.now() },
        ]);

        const ov = await svc.hubOverview(TENANT, 'insp1');
        expect(ov).toMatchObject({
            inspectionStatus: expect.any(String),
            agreementSigned: true,
            paymentStatus: 'paid',
            reportPublished: true,
            progress: expect.objectContaining({ completed: 5, total: 8 }),
            unreadMessages: 1,
        });
    });

    it('hubOverview falls back to {completed:0,total:0} when progress build throws', async () => {
        await seedInspection(testDb, 'insp1');
        const throwingSvc = new PortalService({} as D1Database, {
            getObserveProgress: async () => { throw new Error('no report'); },
        });
        const ov = await throwingSvc.hubOverview(TENANT, 'insp1');
        expect(ov?.progress).toEqual({ completed: 0, total: 0 });
    });

    it('hubOverview returns null for an unknown inspection', async () => {
        expect(await svc.hubOverview(TENANT, 'nope')).toBeNull();
    });
});
