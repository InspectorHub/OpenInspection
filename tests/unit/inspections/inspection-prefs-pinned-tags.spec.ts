/**
 * Pinned tags only ever name tags that still exist. The delete handler unpins (tag.service.spec.ts); this pins the
 * read side, which also has to drop an id left behind by an older build, and the PATCH merge, which must not
 * carry such an id forward.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import prefsRoutes from '../../../server/api/inspection-prefs';
import type { HonoConfig } from '../../../server/types/hono';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTHER = '00000000-0000-0000-0000-000000000002';

describe('inspection prefs - pinned tags that no longer exist', () => {
    let testDb: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const setup = createTestDb();
        testDb = setup.db;
        await setupSchema(setup.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        await testDb.insert(schema.tenants).values([
            { id: TENANT, slug: 'a', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
            { id: OTHER, slug: 'b', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        ]);
        await testDb.insert(schema.tags).values([
            { id: 'live', tenantId: TENANT, name: 'Live', color: null, isSeed: false, createdAt: new Date() },
            { id: 'foreign', tenantId: OTHER, name: 'Foreign', color: null, isSeed: false, createdAt: new Date() },
        ]);
        await testDb.insert(schema.tenantConfigs).values({
            tenantId: TENANT,
            updatedAt: new Date(),
            inspectionPrefs: { cloneDefault: 'rating_notes', autoAdvanceDelayMs: 200, pinnedTagIds: ['live', 'ghost', 'foreign'] },
        });
    });

    function app() {
        const a = new OpenAPIHono<HonoConfig>();
        a.use('*', async (c, next) => {
            c.set('userRole', 'owner');
            c.set('tenantId', TENANT);
            await next();
        });
        a.route('/', prefsRoutes);
        return a;
    }

    it('GET drops an id with no tag behind it, and an id that belongs to another company', async () => {
        const res = await app().request('/', {}, { DB: {} });
        expect(res.status).toBe(200);
        const body = await res.json() as { pinnedTagIds: string[] };
        expect(body.pinnedTagIds).toEqual(['live']);
    });

    it('PATCH of an unrelated field does not write the dead ids back', async () => {
        const res = await app().request('/', {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ autoAdvanceDelayMs: 300 }),
        }, { DB: {} });
        expect(res.status).toBe(200);
        const stored = await testDb.select({ p: schema.tenantConfigs.inspectionPrefs }).from(schema.tenantConfigs)
            .where(eq(schema.tenantConfigs.tenantId, TENANT)).get();
        expect(stored?.p?.pinnedTagIds).toEqual(['live']);
        expect(stored?.p?.autoAdvanceDelayMs).toBe(300);
    });
});
