import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RepairRequestService } from '../../../server/services/repair-request.service';
import { SHARE_TOKEN_TTL_MS } from '../../../server/lib/token-ttl';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-000000000001';
const INSP = '11111111-1111-1111-1111-111111111111';
const T0 = 1_700_000_000_000;

// IA-37 — repair-request share links gained expiresAt/revokedAt. Issuance
// stamps a default TTL; public resolution fails closed on a dead link.
describe('share token lifecycle (IA-37)', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let clock = T0;
    let svc: RepairRequestService;

    beforeEach(async () => {
        const f = createTestDb();
        db = f.db as BetterSQLite3Database<typeof schema>;
        await setupSchema(f.sqlite);
        (mockDrizzle as any).mockReturnValue(db);
        await db.insert(schema.tenants).values({
            id: TENANT, slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', maxUsers: 5, createdAt: new Date(),
        } as any);
        clock = T0;
        let idSeq = 0;
        svc = new RepairRequestService({} as D1Database, () => `id-${++idSeq}`, () => clock);
    });

    it('stamps a ~180-day expiry on create', async () => {
        const rr = await svc.create(TENANT, INSP, { kind: 'client', ref: 'recip-1' });
        const row = await db.select().from(schema.repairRequests)
            .where(eq(schema.repairRequests.id, rr.id)).get();
        expect((row!.expiresAt as Date).getTime()).toBe(T0 + SHARE_TOKEN_TTL_MS);
        expect(row!.revokedAt).toBeNull();
    });

    it('resolves a live share token', async () => {
        const rr = await svc.create(TENANT, INSP, { kind: 'client', ref: 'recip-1' });
        const got = await svc.getByShareToken(rr.shareToken);
        expect(got?.request.id).toBe(rr.id);
    });

    it('fails closed once the share token has expired', async () => {
        const rr = await svc.create(TENANT, INSP, { kind: 'client', ref: 'recip-1' });
        clock = T0 + SHARE_TOKEN_TTL_MS + 1; // walk past expiry
        expect(await svc.getByShareToken(rr.shareToken)).toBeNull();
    });

    it('fails closed once the share token is revoked', async () => {
        const rr = await svc.create(TENANT, INSP, { kind: 'client', ref: 'recip-1' });
        await db.update(schema.repairRequests).set({ revokedAt: new Date(clock) })
            .where(eq(schema.repairRequests.id, rr.id));
        expect(await svc.getByShareToken(rr.shareToken)).toBeNull();
    });
});
