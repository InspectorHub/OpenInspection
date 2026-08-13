/**
 * What a contractor-type delete will orphan.
 *
 * `comments.recommended_contractor_type_id` is a SOFT reference — the schema
 * says so in as many words, and says a stale ref is acceptable. So the delete
 * is not the problem; the silence was. This spec pins the count that makes the
 * cost visible, and pins the delete as still succeeding so a later reader does
 * not "fix" the disclosure into a 409.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { contractorTypes, comments, tenants } from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import { ContractorTypeService } from '../../../server/services/contractor-type.service';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTHER  = '00000000-0000-0000-0000-000000000002';

describe('ContractorTypeService.countReferences', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let svc: ContractorTypeService;

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        const { drizzle } = await import('drizzle-orm/d1');
        (drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
        svc = new ContractorTypeService({} as D1Database);
        for (const [id, name] of [[TENANT, 'Acme'], [OTHER, 'Globex']] as const) {
            await testDb.insert(tenants).values({
                id, slug: name.toLowerCase(), status: 'active',
                deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
            });
        }
        await testDb.insert(contractorTypes).values({
            id: 'ct-1', tenantId: TENANT, name: 'Licensed Plumber', sortOrder: 1, createdAt: new Date(),
        } as typeof contractorTypes.$inferInsert);
    });

    const addComment = (v: { id: string; tenantId: string; ref: string | null }) =>
        testDb.insert(comments).values({
            id: v.id, tenantId: v.tenantId, recommendedContractorTypeId: v.ref,
            text: 'Recommend a licensed plumber.', createdAt: new Date(),
        } as typeof comments.$inferInsert);

    it('counts zero when nothing references it', async () => {
        expect(await svc.countReferences('ct-1', TENANT)).toEqual({ comments: 0 });
    });

    it('counts the comments that reference it', async () => {
        await addComment({ id: 'c-1', tenantId: TENANT, ref: 'ct-1' });
        await addComment({ id: 'c-2', tenantId: TENANT, ref: 'ct-1' });
        await addComment({ id: 'c-3', tenantId: TENANT, ref: null });
        expect(await svc.countReferences('ct-1', TENANT)).toEqual({ comments: 2 });
    });

    // The reference is tenant-scoped like everything else here. A count that
    // leaked across tenants would tell one workspace how another uses its
    // library, and would inflate the number the dialog shows.
    it('does not count another tenant\'s comments', async () => {
        await addComment({ id: 'c-4', tenantId: OTHER, ref: 'ct-1' });
        expect(await svc.countReferences('ct-1', TENANT)).toEqual({ comments: 0 });
    });

    // The delete is deliberately NOT blocked -- the schema calls a stale ref
    // acceptable. This test is what stops a later reader "fixing" it into a 409.
    it('delete still succeeds when references exist', async () => {
        await addComment({ id: 'c-5', tenantId: TENANT, ref: 'ct-1' });
        await expect(svc.delete('ct-1', TENANT)).resolves.toBeUndefined();
    });
});
