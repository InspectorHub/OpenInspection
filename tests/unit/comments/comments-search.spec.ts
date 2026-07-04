/**
 * Track H (IA-5) — GET /api/admin/comments?search= pushed down to SQL.
 *
 * The legacy behavior filtered in JS AFTER the LIMIT, so any match that
 * sorted beyond the first page silently never surfaced (and the pagination
 * total was an upper bound). These tests pin the fixed contract:
 *   1. a match beyond pageSize rows still returns (the pushdown),
 *   2. the curated search_keywords column participates,
 *   3. marketplace-imported rows (libraryId set) are searchable,
 *   4. the pagination total is exact under search.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { OpenAPIHono } from '@hono/zod-openapi';
import adminRoutes from '../../../server/api/admin';
import type { HonoConfig } from '../../../server/types/hono';

const TENANT = '00000000-0000-0000-0000-000000000001';

let db: BetterSQLite3Database<typeof schema>;

function buildApp() {
    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.set('userRole', 'inspector' as never);
        c.set('tenantId', TENANT);
        c.set('user', { sub: 'u1' } as never);
        await next();
    });
    app.route('/api/admin', adminRoutes);
    return app;
}

async function search(q: string, pageSize = 12): Promise<{ texts: string[]; total: number }> {
    const res = await buildApp().request(
        `/api/admin/comments?search=${encodeURIComponent(q)}&pageSize=${pageSize}`,
        {},
        { DB: {} },
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ text: string }>; meta: { total: number } };
    return { texts: body.data.map(d => d.text), total: body.meta.total };
}

describe('GET /api/admin/comments?search= — SQL pushdown (Track H)', () => {
    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        await setupSchema(fixture.sqlite);
        await db.insert(schema.tenants).values({
            id: TENANT, name: 'T', slug: 't', createdAt: new Date(),
        });
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    });

    it('finds a match that sorts beyond the first page (the legacy JS post-filter missed it)', async () => {
        // 12 fillers that sort FIRST (ratingBucket asc puts 'defect' before null),
        // then the needle row sorting last — a pageSize-12 fetch without the
        // pushdown would never contain it.
        const fillers = Array.from({ length: 12 }, (_, i) => ({
            id: `f${i}`, tenantId: TENANT, text: `Filler entry ${i}`,
            ratingBucket: 'defect' as const, section: null, category: null, createdAt: new Date(),
        }));
        await db.insert(schema.comments).values([
            ...fillers,
            { id: 'needle', tenantId: TENANT, text: 'Water staining observed on roof covering.', ratingBucket: null, section: null, category: null, createdAt: new Date() },
        ]);

        const { texts, total } = await search('water staining');
        expect(texts).toHaveLength(1);
        expect(texts[0]).toContain('Water staining');
        expect(total).toBe(1); // exact, not an upper bound
    });

    it('matches via the curated search_keywords column', async () => {
        await db.insert(schema.comments).values({
            id: 'kw', tenantId: TENANT, text: 'Shingle granule loss at south slope.',
            searchKeywords: 'wear aging deterioration',
            ratingBucket: 'monitor', section: null, category: null, createdAt: new Date(),
        });
        const { texts } = await search('deterioration');
        expect(texts).toEqual(['Shingle granule loss at south slope.']);
    });

    it('marketplace-imported rows (libraryId set) participate in search', async () => {
        await db.insert(schema.comments).values({
            id: 'imp', tenantId: TENANT, text: 'Imported: flue cap missing at water heater vent.',
            libraryId: 'lib-spectora-1',
            ratingBucket: 'defect', section: null, category: null, createdAt: new Date(),
        });
        const { texts } = await search('flue cap');
        expect(texts).toEqual(['Imported: flue cap missing at water heater vent.']);
    });

    it('search never leaks another tenant\'s rows', async () => {
        await db.insert(schema.tenants).values({ id: 't2', name: 'O', slug: 'o', createdAt: new Date() });
        await db.insert(schema.comments).values({
            id: 'other', tenantId: 't2', text: 'Water staining elsewhere.',
            ratingBucket: null, section: null, category: null, createdAt: new Date(),
        });
        const { texts, total } = await search('water staining');
        expect(texts).toHaveLength(0);
        expect(total).toBe(0);
    });
    it('rating filter applies in filterMode=all too (the modal bucket chips)', async () => {
        await db.insert(schema.comments).values([
            { id: 'd1', tenantId: TENANT, text: 'Defect one.', ratingBucket: 'defect', section: null, category: null, createdAt: new Date() },
            { id: 's1', tenantId: TENANT, text: 'Sat one.', ratingBucket: 'satisfactory', section: null, category: null, createdAt: new Date() },
        ]);
        const res = await buildApp().request(
            '/api/admin/comments?filterMode=all&rating=defect',
            {},
            { DB: {} },
        );
        expect(res.status).toBe(200);
        const body = await res.json() as { data: Array<{ text: string }> };
        expect(body.data.map(d => d.text)).toEqual(['Defect one.']);
    });
});
