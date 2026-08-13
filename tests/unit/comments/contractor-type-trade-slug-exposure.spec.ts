/**
 * `trade_slug` has been written since it shipped and has never reached a
 * caller, because `ContractorTypeSchema` — the response schema every
 * list/create/update route composes — did not declare it. Zod strips what it
 * does not declare, so the column was invisible no matter what the service
 * returned.
 *
 * That is why this spec runs the REAL service output through the REAL response
 * schema. Asserting on the service alone would pass today and would have passed
 * every day the column was invisible: the row carries the slug either way, and
 * the schema is where it was being dropped.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { z } from '@hono/zod-openapi';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { contractorTypes, tenants } from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import { ContractorTypeService } from '../../../server/services/contractor-type.service';
import { ContractorTypeSchema } from '../../../server/lib/validations/contractor-type.schema';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

const TENANT = '00000000-0000-0000-0000-000000000001';

describe('ContractorTypeSchema — trade_slug reaches the caller', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let svc: ContractorTypeService;

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        const { drizzle } = await import('drizzle-orm/d1');
        (drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
        svc = new ContractorTypeService({} as D1Database);
        await testDb.insert(tenants).values({
            id: TENANT, slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await testDb.insert(contractorTypes).values([
            { id: 'ct-1', tenantId: TENANT, name: 'Licensed Plumber', sortOrder: 1, tradeSlug: 'licensed-plumber', createdAt: new Date() },
            { id: 'ct-2', tenantId: TENANT, name: 'Foundation Specialist', sortOrder: 2, tradeSlug: null, createdAt: new Date() },
        ] as (typeof contractorTypes.$inferInsert)[]);
    });

    /** What `GET /api/contractor-types` puts on the wire. */
    async function listAsServed() {
        const rows = await svc.listByTenant(TENANT);
        return z.array(ContractorTypeSchema).parse(rows);
    }

    it('serves the slug for a type that maps to a canonical trade', async () => {
        const served = await listAsServed();
        expect(served.find((t) => t.id === 'ct-1')?.tradeSlug).toBe('licensed-plumber');
    });

    // NULL is a permanent, legitimate state for a tenant-created type, not a
    // backfill gap — so it has to survive as null rather than vanish.
    it('serves null for a tenant-created type with no canonical counterpart', async () => {
        const served = await listAsServed();
        const row = served.find((t) => t.id === 'ct-2');
        expect(row).toHaveProperty('tradeSlug');
        expect(row?.tradeSlug).toBeNull();
    });

    // The slug is the seeder's to assign. A tenant-settable one would let two
    // rows claim one canonical trade, and the partial unique index would then
    // surface that as a constraint error rather than a message.
    it('is not accepted from a create or update request', async () => {
        const { CreateContractorTypeSchema, UpdateContractorTypeSchema } =
            await import('../../../server/lib/validations/contractor-type.schema');
        expect(Object.keys(CreateContractorTypeSchema.shape)).not.toContain('tradeSlug');
        expect(Object.keys(UpdateContractorTypeSchema.shape)).not.toContain('tradeSlug');
    });
});
