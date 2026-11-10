/**
 * The two platform routes that act on collaborative-document objects: the batched migration and the orphan-object purge.
 *
 * They mount on the real middleware chain (the `x-portal-m2m` guard is the real one) with `drizzle-orm/d1` pointed at an
 * in-memory SQLite. The Durable Object namespaces are fakes: workerd does not implement jurisdictions, so what a real pinned
 * namespace does with `idFromString` cannot be shown here and only the deployed platform can show it. The migration fakes run
 * the real state-transfer verbs, so the refusal and replacement rules under test are the shipped ones.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { HonoConfig } from '../../../server/types/hono';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import collabAdminRoutes from '../../../server/portal/collab-admin.routes';
import { signM2mHeader, M2M_HEADER } from '../../../server/lib/m2m-auth';
import { logger } from '../../../server/lib/logger';
import { collabDocName } from '../../../server/lib/collab/doc-name';
import { docBytes, fakeNamespace, identity, stored, type FakeNamespace } from '../helpers/fake-collab-namespace';

const FAKE_PEM = `-----BEGIN PRIVATE KEY-----\n${btoa('test-m2m-shared-key-material-0123456789')}\n-----END PRIVATE KEY-----`;
const KEY_ENV = { JWT_CURRENT_KID: 'v1', JWT_PRIVATE_KEY_V1: FAKE_PEM };
const TENANT = 't1';

type Env = Record<string, string | object>;

function buildApp() {
    const app = new OpenAPIHono<HonoConfig>();
    app.route('/api/platform', collabAdminRoutes);
    return app;
}

async function post(app: OpenAPIHono<HonoConfig>, path: string, body: object | string, env: Env, signed = true) {
    return app.request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(signed ? { [M2M_HEADER]: await signM2mHeader(KEY_ENV) } : {}) },
        body: typeof body === 'string' ? body : JSON.stringify(body),
    }, { ...KEY_ENV, DB: {}, ...env });
}

interface Totals { total: number; rows: Array<{ rowId: string; outcome: string }>; restored?: boolean; copied: number; wouldCopy: number; alreadyThere: number; replaced: number; nextCursor: string | null; dryRun: boolean; conflicts: Array<{ reason: string }> }
const data = async (res: Response) => ((await res.json()) as { success: boolean; data: Totals }).data;

describe('POST /api/platform/collab-migrate', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];
    let from: FakeNamespace;
    let to: FakeNamespace;
    const names = ['r1', 'r2', 'r3', 'r4', 'r5'];

    beforeEach(async () => {
        vi.restoreAllMocks();
        const fix = createTestDb();
        testDb = fix.db;
        sqlite = fix.sqlite;
        await setupSchema(fix.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        await testDb.insert(schema.tenants).values({ id: TENANT, slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() });
        const insp = (id: string) => ({
            id, tenantId: TENANT, propertyAddress: id, date: '2026-06-01', status: 'requested', paymentStatus: 'unpaid',
            price: 0, agreementRequired: false, paymentRequired: false, createdAt: new Date(),
        });
        await testDb.insert(schema.inspections).values(names.map((_n, i) => insp(`i${i + 1}`)) as never);
        await testDb.insert(schema.inspectionResults).values(names.map((r, i) => ({
            id: `row-${i + 1}`, tenantId: TENANT, inspectionId: `i${i + 1}`, data: {}, ydocState: new Uint8Array([1]), lastSyncedAt: new Date(), reportId: r,
        })) as never);
        from = fakeNamespace(Object.fromEntries(names.map((r, i) => [collabDocName(TENANT, r), stored(docBytes(r), identity(TENANT, `i${i + 1}`, r))])));
        to = fakeNamespace({});
    });

    const env = (): Env => ({ INSPECTION_DOC: to, INSPECTION_DOC_UNPINNED: from });

    it('refuses a call without the signed header', async () => {
        const res = await post(buildApp(), '/api/platform/collab-migrate', {}, env(), false);
        expect(res.status).toBe(403);
        expect(from.calls).toEqual([]);
    });

    it('is a dry run by default: it counts, and touches neither namespace', async () => {
        const res = await post(buildApp(), '/api/platform/collab-migrate', {}, env());
        expect(res.status).toBe(200);
        const out = await data(res);
        expect(out).toMatchObject({ dryRun: true, wouldCopy: 5, copied: 0, nextCursor: null });
        expect(from.calls).toEqual([]);
        expect(to.calls).toEqual([]);
    });

    it('refuses replaceDerived together with a dry run', async () => {
        const res = await post(buildApp(), '/api/platform/collab-migrate', { replaceDerived: true }, env());
        expect(res.status).toBe(400);
    });

    it('refuses an invalid body, an unbounded batch, and answers 409 when pinning is not on', async () => {
        const app = buildApp();
        expect((await post(app, '/api/platform/collab-migrate', 'not json', env())).status).toBe(400);
        expect((await post(app, '/api/platform/collab-migrate', { limit: 11 }, env())).status).toBe(400);
        expect((await post(app, '/api/platform/collab-migrate', { limit: 0 }, env())).status).toBe(400);
        expect((await post(app, '/api/platform/collab-migrate', { dryRun: false }, { INSPECTION_DOC: to })).status).toBe(409);
        expect((await post(app, '/api/platform/collab-migrate', { dryRun: false }, {})).status).toBe(409);
    });

    it('works in batches: each call hands back a cursor, resuming covers every row once, and the last call has none', async () => {
        const app = buildApp();
        const seen: number[] = [];
        let cursor: string | null = null;
        let guard = 0;
        do {
            const res = await post(app, '/api/platform/collab-migrate', { dryRun: false, limit: 2, ...(cursor ? { cursor } : {}) }, env());
            expect(res.status).toBe(200);
            const out = await data(res);
            seen.push(out.copied);
            cursor = out.nextCursor;
        } while (cursor && ++guard < 10);
        expect(seen).toEqual([2, 2, 1]);
        expect([...to.stores.keys()].sort()).toEqual(names.map((r) => collabDocName(TENANT, r)).sort());
    });

    it('names each row in the response with its row id and outcome, and in the log line', async () => {
        const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
        const out = await data(await post(buildApp(), '/api/platform/collab-migrate', { dryRun: false, limit: 2 }, env()));
        expect(out.rows).toEqual([{ rowId: 'row-1', name: collabDocName(TENANT, 'r1'), outcome: 'copied' }, { rowId: 'row-2', name: collabDocName(TENANT, 'r2'), outcome: 'copied' }]);
        const line = info.mock.calls.find(([m]) => m === 'collab migrate batch');
        expect(line?.[1]).toMatchObject({ rows: [{ rowId: 'row-1', outcome: 'copied' }, { rowId: 'row-2', outcome: 'copied' }] });
    });

    it('is idempotent: running the whole sequence again copies nothing and reports every document as already there', async () => {
        const app = buildApp();
        await post(app, '/api/platform/collab-migrate', { dryRun: false, limit: 10 }, env());
        const again = await data(await post(app, '/api/platform/collab-migrate', { dryRun: false, limit: 10 }, env()));
        expect(again).toMatchObject({ copied: 0, alreadyThere: 5 });
    });

    it('never touches the source object beyond reading it', async () => {
        await post(buildApp(), '/api/platform/collab-migrate', { dryRun: false, limit: 10 }, env());
        expect(from.calls.every((c) => c.startsWith('GET /state-export'))).toBe(true);
    });

    it('a full batch stays inside the subrequest budget (under 40 including the listing and the database check)', async () => {
        await post(buildApp(), '/api/platform/collab-migrate', { dryRun: false, limit: 10 }, env());
        expect(from.calls.length + to.calls.length + 2).toBeLessThanOrEqual(40);
    });

    it('logs exactly one structured line per call, with the cursor and the counters and no document content', async () => {
        const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
        await post(buildApp(), '/api/platform/collab-migrate', { dryRun: false, limit: 2 }, env());
        const lines = info.mock.calls.filter(([m]) => m === 'collab migrate batch');
        expect(lines).toHaveLength(1);
        expect(lines[0]?.[1]).toMatchObject({ dryRun: false, limit: 2, total: 2, copied: 2, replaceDerived: false });
        expect(JSON.stringify(lines[0]?.[1])).not.toContain('results');
    });

    it('does not copy a document that lacks something the database gained since: the row is a conflict with the reason, nothing is imported', async () => {
        await testDb.update(schema.inspectionResults).set({ data: { 'a:b:c': { rating: 'defect', notes: 'written straight to the database' } } }).where(eq(schema.inspectionResults.id, 'row-1'));
        const res = await post(buildApp(), '/api/platform/collab-migrate', { dryRun: false, limit: 10 }, env());
        const out = await data(res);
        expect(out).toMatchObject({ copied: 4 });
        expect(out.conflicts.map((c) => c.reason)).toEqual(['source-differs-from-database']);
        expect(to.stores.get(collabDocName(TENANT, 'r1'))?.has('ydoc') ?? false).toBe(false);
    });

    it('undoes a replacement for one row: restoreBackupFor puts the displaced document back, and 404s when there is nothing to restore', async () => {
        vi.spyOn(logger, 'info').mockImplementation(() => undefined);
        const displaced = docBytes('built-from-database');
        to = fakeNamespace({ [collabDocName(TENANT, 'r1')]: stored(displaced, identity(TENANT, 'i1', 'r1'), true) });
        await post(buildApp(), '/api/platform/collab-migrate', { dryRun: false, replaceDerived: true, limit: 1 }, env());
        expect(to.stores.get(collabDocName(TENANT, 'r1'))?.get('ydoc')).not.toEqual(displaced);
        const res = await post(buildApp(), '/api/platform/collab-migrate', { restoreBackupFor: 'row-1' }, env());
        expect(res.status).toBe(200);
        expect(to.stores.get(collabDocName(TENANT, 'r1'))?.get('ydoc')).toEqual(displaced);
        expect((await post(buildApp(), '/api/platform/collab-migrate', { restoreBackupFor: 'row-1' }, env())).status).toBe(404);
        expect((await post(buildApp(), '/api/platform/collab-migrate', { restoreBackupFor: 'no-such-row' }, env())).status).toBe(404);
    });

    it('refuses a restore without the signed header and a restore mixed with batch fields', async () => {
        expect((await post(buildApp(), '/api/platform/collab-migrate', { restoreBackupFor: 'row-1' }, env(), false)).status).toBe(403);
        expect((await post(buildApp(), '/api/platform/collab-migrate', { restoreBackupFor: 'row-1', dryRun: false }, env())).status).toBe(400);
    });

    it('one malformed row does not block the batch: it is a conflict with its reason, the others copy, and the cursor still advances', async () => {
        sqlite.prepare("UPDATE inspection_results SET data = 'not json {' WHERE id = 'row-2'").run();
        const first = await data(await post(buildApp(), '/api/platform/collab-migrate', { dryRun: false, limit: 3 }, env()));
        expect(first).toMatchObject({ copied: 2, nextCursor: 'row-3' });
        expect(first.conflicts.map((c) => c.reason)).toEqual(['database-row-unreadable']);
        const second = await data(await post(buildApp(), '/api/platform/collab-migrate', { dryRun: false, limit: 3, cursor: 'row-3' }, env()));
        expect(second).toMatchObject({ copied: 2, nextCursor: null });
    });

    it('refuses to restore a backup that no longer matches the database, and changes nothing', async () => {
        vi.spyOn(logger, 'info').mockImplementation(() => undefined);
        const displaced = docBytes('built-from-database');
        to = fakeNamespace({ [collabDocName(TENANT, 'r1')]: stored(displaced, identity(TENANT, 'i1', 'r1'), true) });
        await post(buildApp(), '/api/platform/collab-migrate', { dryRun: false, replaceDerived: true, limit: 1 }, env());
        const replacedDoc = to.stores.get(collabDocName(TENANT, 'r1'))?.get('ydoc');
        await testDb.update(schema.inspectionResults).set({ data: { 'a:b:c': { rating: 'defect' } } }).where(eq(schema.inspectionResults.id, 'row-1'));
        const res = await post(buildApp(), '/api/platform/collab-migrate', { restoreBackupFor: 'row-1' }, env());
        expect(res.status).toBe(409);
        expect(await res.json()).toMatchObject({ error: { message: expect.stringContaining('database') } });
        expect(to.stores.get(collabDocName(TENANT, 'r1'))?.get('ydoc')).toEqual(replacedDoc);
    });

    it('refuses to restore once the replacement was edited', async () => {
        vi.spyOn(logger, 'info').mockImplementation(() => undefined);
        to = fakeNamespace({ [collabDocName(TENANT, 'r1')]: stored(docBytes('built-from-database'), identity(TENANT, 'i1', 'r1'), true) });
        await post(buildApp(), '/api/platform/collab-migrate', { dryRun: false, replaceDerived: true, limit: 1 }, env());
        to.stores.get(collabDocName(TENANT, 'r1'))?.set('ydoc', docBytes('a client edited this'));
        const res = await post(buildApp(), '/api/platform/collab-migrate', { restoreBackupFor: 'row-1' }, env());
        expect(res.status).toBe(409);
        expect(await res.json()).toMatchObject({ error: { message: expect.stringContaining('edited') } });
    });

    it('restore ignores dryRun by design: it is an explicit, separate write, refused only when mixed with batch fields', async () => {
        expect((await post(buildApp(), '/api/platform/collab-migrate', { restoreBackupFor: 'row-1', dryRun: true }, env())).status).toBe(400);
    });

    it('replaceDerived resolves a target that only the database shaped, and leaves an edited one as a conflict with its reason', async () => {
        vi.spyOn(logger, 'info').mockImplementation(() => undefined);
        to = fakeNamespace({
            [collabDocName(TENANT, 'r1')]: stored(docBytes('lossy'), identity(TENANT, 'i1', 'r1'), true),
            [collabDocName(TENANT, 'r2')]: stored(docBytes('edited'), identity(TENANT, 'i2', 'r2'), false),
        });
        const out = await data(await post(buildApp(), '/api/platform/collab-migrate', { dryRun: false, replaceDerived: true, limit: 10 }, env()));
        expect(out).toMatchObject({ replaced: 1, copied: 3 });
        expect(out.conflicts.map((c) => c.reason)).toEqual(['target-edited']);
    });
});

/** A namespace whose id parsing and purge can each be made to fail, to follow the route through its fallbacks. */
interface PurgeNs { calls: string[]; tenants: Array<string | null>; idFromString(hex: string): string; get(id: string): { fetch(url: string, init?: RequestInit): Promise<Response> } }
function purgeNs(label: string, opts: { parse?: 'throws'; fetch?: 'throws' | 'fails' | 'refuses' } = {}): PurgeNs {
    const calls: string[] = [];
    const tenants: Array<string | null> = [];
    return {
        calls,
        tenants,
        idFromString: (hex) => { if (opts.parse === 'throws') throw new Error('id is not from this namespace'); return `${label}:${hex}`; },
        get: (id) => ({
            fetch: async (url, init) => {
                calls.push(`${init?.method ?? 'GET'} ${new URL(url).pathname} ${id}`);
                tenants.push(new Headers(init?.headers).get('x-expected-tenant'));
                if (opts.fetch === 'refuses') return Response.json({ error: 'wrong-tenant' }, { status: 403 });
                if (opts.fetch === 'throws') throw new Error('unreachable');
                return opts.fetch === 'fails' ? new Response('boom', { status: 500 }) : Response.json({ purged: true });
            },
        }),
    };
}

describe('POST /api/platform/tenants/:slug/inspection-doc/purge', () => {
    const HEX = 'ab'.repeat(32);
    const path = '/api/platform/tenants/acme/inspection-doc/purge';

    beforeEach(async () => {
        vi.restoreAllMocks();
        const fix = createTestDb();
        await setupSchema(fix.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(fix.db);
        await fix.db.insert(schema.tenants).values({ id: TENANT, slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() });
        vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    });

    const call = (pinned: PurgeNs | undefined, legacy: PurgeNs | undefined, body: object = { durableObjectId: HEX }, signed = true) =>
        post(buildApp(), path, body, { ...(pinned ? { INSPECTION_DOC: pinned } : {}), ...(legacy ? { INSPECTION_DOC_UNPINNED: legacy } : {}) }, signed);

    it('refuses an unsigned call and a malformed id', async () => {
        expect((await call(purgeNs('p'), undefined, { durableObjectId: HEX }, false)).status).toBe(403);
        expect((await call(purgeNs('p'), undefined, { durableObjectId: 'xyz' })).status).toBe(400);
    });

    it('purges through the pinned namespace and reports which, leaving the old namespace alone', async () => {
        const pinned = purgeNs('p');
        const legacy = purgeNs('l');
        const res = await call(pinned, legacy);
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ data: { purged: true, durableObjectId: HEX, namespace: 'pinned' } });
        expect(pinned.calls).toEqual([`POST /purge p:${HEX}`]);
        expect(legacy.calls).toEqual([]);
    });

    it('sends the tenant it resolved from the slug with the purge, so the object can check ownership', async () => {
        const pinned = purgeNs('p');
        await call(pinned, undefined);
        expect(pinned.tenants).toEqual([TENANT]);
    });

    it('answers 403 and stops when the object says it belongs to another tenant: the other namespace is never tried', async () => {
        const pinned = purgeNs('p', { fetch: 'refuses' });
        const legacy = purgeNs('l');
        const res = await call(pinned, legacy);
        expect(res.status).toBe(403);
        expect(await res.json()).toMatchObject({ success: false });
        expect(legacy.calls).toEqual([]);
    });

    it('falls back to the pre-pinning namespace when the pinned one will not take the id, and says so', async () => {
        const pinned = purgeNs('p', { parse: 'throws' });
        const legacy = purgeNs('l');
        const res = await call(pinned, legacy);
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ data: { namespace: 'legacy' } });
        expect(legacy.calls).toEqual([`POST /purge l:${HEX}`]);
        expect(pinned.calls).toEqual([]);
    });

    it('also falls back when the pinned namespace parses the id but cannot reach an object with it', async () => {
        const pinned = purgeNs('p', { fetch: 'throws' });
        const legacy = purgeNs('l');
        const res = await call(pinned, legacy);
        expect(await res.json()).toMatchObject({ data: { namespace: 'legacy' } });
    });

    it('answers 404 when neither namespace recognises the id, and 502 when one recognised it but the purge failed', async () => {
        expect((await call(purgeNs('p', { parse: 'throws' }), purgeNs('l', { parse: 'throws' }))).status).toBe(404);
        expect((await call(purgeNs('p', { fetch: 'fails' }), purgeNs('l', { fetch: 'fails' }))).status).toBe(502);
    });

    it('behaves as before when there is no pre-pinning namespace', async () => {
        expect((await call(purgeNs('p'), undefined)).status).toBe(200);
        expect((await call(purgeNs('p', { fetch: 'fails' }), undefined)).status).toBe(502);
        expect((await call(purgeNs('p', { parse: 'throws' }), undefined)).status).toBe(404);
    });

    it('answers 503 when collaborative editing is not bound, and 404 for an unknown tenant', async () => {
        expect((await call(undefined, undefined)).status).toBe(503);
        const res = await post(buildApp(), '/api/platform/tenants/nope/inspection-doc/purge', { durableObjectId: HEX }, { INSPECTION_DOC: purgeNs('p') });
        expect(res.status).toBe(404);
    });
});
