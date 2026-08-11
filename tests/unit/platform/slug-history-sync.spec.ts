/**
 * Spec section 9 — core records the previous slug on the tenant sync it ALREADY
 * receives.
 *
 * `portal.provider.ts` detects `existingTenant.slug !== slug` in order to drop
 * the stale `tenant:<old-slug>` KV entry, so both slugs are already in hand at
 * that line: no new command type, no transport change.
 *
 * Core's copy answers RESOLUTION ("who used to own this"); portal's answers
 * CLAIMABILITY. Neither reads the other.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { tenants, tenantSlugHistory } from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { PortalProvider } from '../../../server/portal/portal.provider';

const TENANT = '11111111-1111-1111-1111-111111111111';

function fakeKv() {
    const store = new Map<string, string>();
    return {
        get: async (k: string) => store.get(k) ?? null,
        put: async (k: string, v: string) => { store.set(k, v); },
        delete: async (k: string) => { store.delete(k); },
    };
}

let testDb: BetterSQLite3Database<typeof schema>;
let kv: ReturnType<typeof fakeKv>;
let provider: PortalProvider;

const seedTenant = (v: { id: string; slug: string }) =>
    testDb.insert(tenants).values({
        ...v, name: v.slug, tier: 'pro', status: 'active', createdAt: new Date(),
    } as typeof tenants.$inferInsert);

describe('PortalProvider — slug history on sync', () => {
    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
        kv = fakeKv();
        provider = new PortalProvider({} as D1Database, kv as unknown as KVNamespace);
    });

    it('records the previous slug when a sync changes it', async () => {
        await seedTenant({ id: TENANT, slug: 'old-slug' });
        await provider.handleTenantUpdate({ id: TENANT, slug: 'new-slug' , status: 'active' });
        const row = await testDb.select().from(tenantSlugHistory)
            .where(eq(tenantSlugHistory.oldSlug, 'old-slug')).get();
        expect(row?.tenantId).toBe(TENANT);
    });

    it('records nothing when the slug is unchanged', async () => {
        await seedTenant({ id: TENANT, slug: 'same' });
        await provider.handleTenantUpdate({ id: TENANT, slug: 'same' , status: 'active' });
        expect(await testDb.select().from(tenantSlugHistory)).toHaveLength(0);
    });

    // Core's copy exists to ANSWER "who used to own this", so it carries no
    // retirement decision of its own — claimability is portal's question and
    // portal is the only writer of tenants.slug. The column is populated so the
    // two tables stay readable side by side, never read by core.
    it('stores a retiredUntil it does not itself enforce', async () => {
        await seedTenant({ id: TENANT, slug: 'old-slug' });
        await provider.handleTenantUpdate({ id: TENANT, slug: 'new-slug' , status: 'active' });
        const row = await testDb.select().from(tenantSlugHistory).get();
        expect(row?.retiredUntil).toBeInstanceOf(Date);
        expect(row!.retiredUntil.getTime()).toBeGreaterThan(row!.changedAt.getTime());
    });

    // Task 6 — resolution caches `tenant:<slug>` for an hour keyed on the
    // REQUESTED slug, so a history hit warms an entry under the OLD owner.
    // Nothing may leave that entry behind when somebody else claims the slug.
    it('drops the cached entry for a slug when a NEW tenant claims it', async () => {
        await testDb.insert(tenantSlugHistory).values({
            oldSlug: 'acme', tenantId: 'old-owner',
            changedAt: new Date(), retiredUntil: new Date(Date.now() + 1000),
        } as typeof tenantSlugHistory.$inferInsert);
        await kv.put('tenant:acme', JSON.stringify({ id: 'old-owner' }));
        await provider.handleTenantUpdate({ id: 'new-owner', slug: 'acme' , status: 'active' });
        expect(await kv.get('tenant:acme')).toBeNull();
    });
});
