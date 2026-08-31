/**
 * The platform admin surface for statutory forms: who is on which revision,
 * what a withdrawal affects, and taking a catalogue entry out of browse.
 *
 * ── WHY THESE ARE M2M ROUTES AND NOT `/api/admin` ONES ──────────────────────
 * Every answer here is ACROSS workspaces -- how many installed, how many
 * documents went out. A workspace owner asking "how many other companies are on
 * revision 7-6" is a cross-tenant read, and no role on a workspace token should
 * carry it. So these sit on the portal↔core M2M surface, whose guard is a MAC
 * over the shared keyring rather than a role, and the first test below is that
 * an unsigned request gets nothing at all.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { HonoConfig } from '../../../server/types/hono';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import statutoryAdminRoutes from '../../../server/portal/statutory-admin.routes';
import { browseCatalogue } from '../../../server/services/marketplace/catalogue-browse';
import { signM2mHeader, M2M_HEADER } from '../../../server/lib/m2m-auth';

const FAKE_PEM = `-----BEGIN PRIVATE KEY-----\n${btoa('test-m2m-shared-key-material-0123456789')}\n-----END PRIVATE KEY-----`;
const ENV = { DB: {}, JWT_CURRENT_KID: 'v1', JWT_PRIVATE_KEY_V1: FAKE_PEM } as Record<string, unknown>;

const FORM = 'yy_flat_form';
const REVISION = 'Rev. 04/26';
const OLDER = 'Rev. 01/25';

let db: BetterSQLite3Database<typeof schema>;
let sqlite: ReturnType<typeof createTestDb>['sqlite'];

function app() {
    const a = new Hono<HonoConfig>();
    a.route('/api/integration', statutoryAdminRoutes);
    return a;
}
async function auth() {
    return { [M2M_HEADER]: await signM2mHeader(ENV as Record<string, string | undefined>) };
}
async function get(path: string) {
    return app().request(path, { headers: await auth() }, ENV);
}

const now = new Date(Date.UTC(2026, 7, 29));

beforeEach(async () => {
    const fx = createTestDb();
    db = fx.db;
    sqlite = fx.sqlite;
    await setupSchema(sqlite);
    vi.mocked(mockDrizzle).mockReturnValue(db as never);

    await db.insert(schema.tenants).values([
        { id: 't1', slug: 'one', createdAt: now },
        { id: 't2', slug: 'two', createdAt: now },
        { id: 't3', slug: 'three', createdAt: now },
        { id: 't4', slug: 'four', createdAt: now },
    ] as never);

    await db.insert(schema.marketplaceLibraries).values([
        {
            id: 'lib-1', name: 'State form pack', kind: 'statutory', semver: '1.1.0',
            schema: { schemaVersion: 2, sections: [] }, authorId: 'system',
            downloadCount: 4, featured: false, createdAt: now, updatedAt: now,
        },
        {
            id: 'lib-2', name: 'Ordinary template pack', kind: 'templates', semver: '2.0.0',
            schema: { schemaVersion: 2, sections: [] }, authorId: 'system',
            downloadCount: 9, featured: false, createdAt: now, updatedAt: now,
        },
    ] as never);

    await db.insert(schema.tenantLibraryImports).values([
        { id: 'imp-1', tenantId: 't1', libraryId: 'lib-1', importedSemver: '1.0.0', importedAt: now, rowCount: 1, localEntityId: 'tpl-1' },
        { id: 'imp-2', tenantId: 't2', libraryId: 'lib-1', importedSemver: '1.0.0', importedAt: now, rowCount: 1, localEntityId: 'tpl-2' },
        { id: 'imp-3', tenantId: 't3', libraryId: 'lib-1', importedSemver: '1.1.0', importedAt: now, rowCount: 1, localEntityId: 'tpl-3' },
        // Uninstalled: this workspace is no longer ON any revision.
        { id: 'imp-4', tenantId: 't4', libraryId: 'lib-1', importedSemver: '1.0.0', importedAt: now, rowCount: 1, localEntityId: 'tpl-4', uninstalledAt: now },
        { id: 'imp-5', tenantId: 't1', libraryId: 'lib-2', importedSemver: '2.0.0', importedAt: now, rowCount: 1, localEntityId: 'tpl-5' },
    ] as never);

    const production = (id: string, tenantId: string, inspectionId: string, version: string) => ({
        id, tenantId, inspectionId, formId: FORM, version,
        sourceHash: 'a'.repeat(64), producedBy: 'u1', producedAt: now,
    });
    await db.insert(schema.statutoryFormProductions).values([
        // Three documents on the revision under recall, from two workspaces --
        // and two of them for the SAME inspection, because a re-issue is a
        // second delivery.
        production('p1', 't1', 'i1', REVISION),
        production('p2', 't1', 'i1', REVISION),
        production('p3', 't2', 'i2', REVISION),
        production('p4', 't3', 'i3', OLDER),
    ] as never);
});

afterEach(() => {
    sqlite.close();
    vi.clearAllMocks();
});

describe('the platform statutory admin surface', () => {
    it('answers nothing at all without a signed M2M header', async () => {
        for (const path of [
            '/api/integration/statutory-forms/installs',
            `/api/integration/statutory-forms/impact?formId=${FORM}&revision=${encodeURIComponent(REVISION)}`,
        ]) {
            const res = await app().request(path, {}, ENV);
            expect(res.status).toBe(403);
        }
        const res = await app().request('/api/integration/marketplace/lib-1/delist',
            { method: 'POST' }, ENV);
        expect(res.status).toBe(403);
        const row = await db.select().from(schema.marketplaceLibraries)
            .where(eqId('lib-1')).get();
        expect(row?.delistedAt ?? null).toBeNull();
    });

    it('reports how many workspaces are on each revision, which is where a recall starts', async () => {
        const res = await get('/api/integration/statutory-forms/installs');
        expect(res.status).toBe(200);
        const body = await res.json() as { data: Array<Record<string, unknown>> };

        expect(body.data).toContainEqual(expect.objectContaining({
            libraryId: 'lib-1', importedSemver: '1.0.0', tenants: 2,
            tenantIds: ['t1', 't2'],
        }));
        // The positive control for the grouping: a second revision reports its
        // OWN count. A handler that returned the total would satisfy the first
        // assertion on a one-revision fixture and be wrong here.
        expect(body.data).toContainEqual(expect.objectContaining({
            libraryId: 'lib-1', importedSemver: '1.1.0', tenants: 1,
        }));
        // t4 uninstalled, so it is on no revision. Counting it would overstate
        // who has to be told about a bad field map.
        const total = body.data.reduce((n, r) => n + (r['tenants'] as number), 0);
        expect(total).toBe(3);
        // The ordinary template pack is not a statutory form and has no
        // revision to be on.
        expect(body.data.some((r) => r['libraryId'] === 'lib-2')).toBe(false);
    });

    it('a withdrawal names the documents already produced, not the inspections', async () => {
        const res = await get(
            `/api/integration/statutory-forms/impact?formId=${FORM}&revision=${encodeURIComponent(REVISION)}`);
        expect(res.status).toBe(200);
        const body = await res.json() as { data: Record<string, unknown> };

        // Three documents left, from two workspaces, covering two inspections.
        // Documents is the number a recall is about: a re-issue put a second
        // copy in somebody's hands and counting inspections would miss it.
        expect(body.data['productions']).toBe(3);
        expect(body.data['tenants']).toBe(2);
        expect(body.data['inspections']).toBe(2);
    });

    it('counts only the revision asked about', async () => {
        // The positive control. A handler that counted the whole table would
        // pass the assertion above and report 4 here.
        const res = await get(
            `/api/integration/statutory-forms/impact?formId=${FORM}&revision=${encodeURIComponent(OLDER)}`);
        const body = await res.json() as { data: Record<string, unknown> };
        expect(body.data['productions']).toBe(1);
        expect(body.data['tenants']).toBe(1);
    });

    it('delisting hides the entry from browse and leaves every install working', async () => {
        const before = await browseCatalogue(db as never, 't1');
        expect(before.rows.some((r) => r.id === 'lib-1')).toBe(true);

        const res = await app().request('/api/integration/marketplace/lib-1/delist',
            { method: 'POST', headers: { ...(await auth()), 'content-type': 'application/json' },
                body: JSON.stringify({ delisted: true }) }, ENV);
        expect(res.status).toBe(200);

        const after = await browseCatalogue(db as never, 't1');
        expect(after.rows.some((r) => r.id === 'lib-1')).toBe(false);
        // The count has to move with the rows, or page 1 shows fewer entries
        // than the pager claims exist.
        expect(after.total).toBe(before.total - 1);
        // Nothing is deleted. tenant_library_imports.libraryId points at the
        // catalogue row, so removing it would orphan every workspace that
        // installed -- delisting is visibility only, the same shape as
        // uninstall.
        const row = await db.select().from(schema.marketplaceLibraries).where(eqId('lib-1')).get();
        expect(row).toBeDefined();
        const imports = await db.select().from(schema.tenantLibraryImports).all();
        expect(imports).toHaveLength(5);
        expect(imports.filter((i) => i.libraryId === 'lib-1' && i.uninstalledAt === null))
            .toHaveLength(3);
    });

    it('a delisting can be taken back, because it deleted nothing', async () => {
        const headers = { ...(await auth()), 'content-type': 'application/json' };
        await app().request('/api/integration/marketplace/lib-1/delist',
            { method: 'POST', headers, body: JSON.stringify({ delisted: true }) }, ENV);
        await app().request('/api/integration/marketplace/lib-1/delist',
            { method: 'POST', headers, body: JSON.stringify({ delisted: false }) }, ENV);
        const after = await browseCatalogue(db as never, 't1');
        expect(after.rows.some((r) => r.id === 'lib-1')).toBe(true);
    });

    it('refuses to delist a catalogue entry that does not exist', async () => {
        const res = await app().request('/api/integration/marketplace/nope/delist',
            { method: 'POST', headers: { ...(await auth()), 'content-type': 'application/json' },
                body: JSON.stringify({ delisted: true }) }, ENV);
        expect(res.status).toBe(404);
    });
});

/** Local helper so the assertions above read as sentences. */
function eqId(id: string) {
    return eq(schema.marketplaceLibraries.id, id);
}
