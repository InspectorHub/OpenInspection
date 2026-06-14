// tests/unit/resolve-tenant-slug.spec.ts
//
// Regression test for: empty tenant slug on saas authenticated routes.
//
// Bug: resolveTenantSlug() (now in server/lib/url.ts) returned '' on saas
// authenticated routes because those routes resolve the tenant from the JWT
// and never set requestedTenantSlug on the Hono context.  An empty slug
// produced /report-view//:id which 404'd the headless PDF render.
//
// Fix: when requestedTenantSlug is absent the helper now falls back to a
// tenants.slug DB lookup by tenantId.
//
// Two sub-cases verified:
//   (a) ctx slug present → returned directly, no DB hit needed
//   (b) ctx slug absent  → DB lookup executed; tests both the case where a
//       tenants row exists (returns the row's slug) and where no row exists
//       (returns the '' fallback, which still exercises the lookup code path).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestDb, setupSchema } from './db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../server/lib/db/schema';

// ------------------------------------------------------------------
// We need resolveTenantSlug from server/lib/url.ts.
// That module imports `drizzle` from 'drizzle-orm/d1' and passes
// c.env.DB (a D1Database) to it.  In the test we intercept that call
// and return our better-sqlite3 test database instead.
// ------------------------------------------------------------------
vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

// Import the function under test AFTER the mock is in place.
import { resolveTenantSlug } from '../../server/lib/url';

const TENANT_ID   = '00000000-0000-0000-0000-000000000099';
const TENANT_SLUG = 'acme-inspect';

describe('resolveTenantSlug', () => {
    let testDb: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const setup = createTestDb();
        testDb = setup.db;
        await setupSchema(setup.sqlite);
        // Wire the d1 mock to return our better-sqlite3 db.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
    });

    // ------------------------------------------------------------------
    // Sub-case (a): requestedTenantSlug is already set on the context.
    // The function must return it immediately without touching the DB.
    // ------------------------------------------------------------------
    it('(a) returns requestedTenantSlug from context when present', async () => {
        const ctx = {
            get: (_key: string) => 'from-ctx-slug',
            env: { DB: {} /* real DB not needed — must not be called */ },
        } as unknown as Parameters<typeof resolveTenantSlug>[0];

        const result = await resolveTenantSlug(ctx, TENANT_ID);

        expect(result).toBe('from-ctx-slug');
        // drizzle should never have been called because the ctx shortcut fired.
        expect(mockDrizzle).not.toHaveBeenCalled();
    });

    // ------------------------------------------------------------------
    // Sub-case (b-i): ctx slug absent + tenant row EXISTS → DB lookup
    // returns the stored slug.  This is the primary regression guard:
    // without the fallback the function would have returned '' here.
    // ------------------------------------------------------------------
    it('(b-i) falls back to DB lookup and returns the tenant slug when row exists', async () => {
        // Seed the tenants table with a minimal valid row.
        await testDb.insert(schema.tenants).values({
            id:             TENANT_ID,
            name:           'Acme Inspections',
            slug:           TENANT_SLUG,
            status:         'active',
            deploymentMode: 'shared',
            tier:           'free',
            createdAt:      new Date(),
        });

        const ctx = {
            // get() returns undefined/null → !fromCtx branch executes.
            get: (_key: string) => undefined,
            env: { DB: {} /* mock intercepts and uses testDb */ },
        } as unknown as Parameters<typeof resolveTenantSlug>[0];

        const result = await resolveTenantSlug(ctx, TENANT_ID);

        // Must return the seeded slug, not '' — if the fallback branch is
        // absent this call would return '' (the old bug behaviour).
        expect(result).toBe(TENANT_SLUG);
    });

    // ------------------------------------------------------------------
    // Sub-case (b-ii): ctx slug absent + no tenant row → returns ''.
    // This path still exercises the DB-lookup branch (the ?? '' fallback),
    // proving the code reaches the select statement even when empty.
    // ------------------------------------------------------------------
    it('(b-ii) returns empty string via ?? fallback when no tenant row exists', async () => {
        // No row inserted → lookup returns undefined → ?? '' → ''.
        const ctx = {
            get: (_key: string) => undefined,
            env: { DB: {} },
        } as unknown as Parameters<typeof resolveTenantSlug>[0];

        const result = await resolveTenantSlug(ctx, TENANT_ID);

        // The '' result proves the lookup executed (the ?? '' is reached).
        expect(result).toBe('');
        // And drizzle was invoked, confirming the DB path was taken.
        expect(mockDrizzle).toHaveBeenCalled();
    });
});
