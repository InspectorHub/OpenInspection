/**
 * What the inspection delete paths must never change for the native client.
 *
 * 1. A deleted inspection stays deleted. An offline package whose inspection.create
 *    names an inspection an earlier import created and an admin has since deleted is
 *    refused whole (409 PACKAGE_INSPECTION_DELETED) with zero writes. The deletes here
 *    go through the real DELETE /api/inspections/:id route, which is what the list's
 *    batch delete and the hub's delete call, one id at a time (there is no bulk
 *    server route). The applied-record table is not part of the delete cascade, so the
 *    memory of the create survives and keeps the refusal possible.
 * 2. Replaying an inspection.update for a deleted inspection does not recreate it.
 * 3. Imports go through POST/PATCH /api/inspections in process. The booking window and
 *    overlap rules live only on the public booking path, so an imported create with no
 *    duration and an update that moves a date onto an existing inspection are applied,
 *    and the calendar conflict query copes with a row that has no recorded window.
 * 4. GET /api/inspections/:id still returns templateSnapshot (the native editor needs it).
 *
 * Every refusal is paired with a positive control.
 */
import { env as testEnv } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import * as Y from 'yjs';
import app from '../../../server/index';
import { buildKeyring, signJwt } from '../../../server/lib/jwt-keyring';
import { NATIVE_SCOPE, type NativeProps } from '../../../server/lib/auth/native-token';
import { seedResultsDoc, applyItemPatch } from '@core/field-ui/shared/results-doc';
import { applyMigrations } from '../migration-replay';
import { buildPackage, type PackageSpec } from '../../unit/helpers/offline-package-fixture';

const migrationSql = import.meta.glob('../../../migrations/*.sql', {
    query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;
const b = testEnv as unknown as { DB: D1Database; PHOTOS: R2Bucket };

const TENANT = 'delete-import-tenant';
const TEMPLATE = 'delete-import-template';
const KEY = '_default:sec1:item1';
const DAY = '2026-10-02';

const grants = new Map<string, NativeProps>();
const provider = {
    unwrapToken: async (t: string) => {
        const props = grants.get(t);
        return props ? { scope: [NATIVE_SCOPE], grant: { clientId: 'c', scope: [NATIVE_SCOPE], props } } : null;
    },
};
const pending: Promise<unknown>[] = [];
const ctx = { waitUntil: (p: Promise<unknown>) => { pending.push(p); }, passThroughOnException: () => undefined } as unknown as ExecutionContext;

async function call(path: string, init: RequestInit & { token?: string } = {}): Promise<Response> {
    const { token, ...rest } = init;
    const headers = new Headers(rest.headers);
    if (token) headers.set('authorization', `Bearer ${token}`);
    const env = { ...testEnv, NATIVE_CLIENT_ENABLED: 'true', OAUTH_PROVIDER: provider };
    const res = await app.fetch(new Request(`http://x${path}`, { ...rest, headers }), env as never, ctx);
    await Promise.all(pending.splice(0));
    return res;
}

let seq = 0;
const fresh = (p: string): string => `${p}-${++seq}-${crypto.randomUUID().slice(0, 6)}`;
let ownerId = '';
let ownerJwt = '';
let nativeToken = '';

const importZip = (zip: Uint8Array): Promise<Response> => call('/api/client/import', {
    method: 'POST', token: nativeToken,
    headers: { 'content-type': 'application/zip', 'content-length': String(zip.byteLength) }, body: new Uint8Array(zip),
});
const asJson = async (res: Response) => (await res.json()) as { data?: { outbox: { applied: number; skipped: number; failed: Array<{ status: number }> } } };

const count = async (sql: string, ...args: unknown[]): Promise<number> =>
    (await b.DB.prepare(sql).bind(...args).first<{ n: number }>())?.n ?? 0;
const inspectionRows = (): Promise<number> => count('SELECT count(*) AS n FROM inspections WHERE tenant_id = ?', TENANT);
const resultRows = (id: string): Promise<number> => count('SELECT count(*) AS n FROM inspection_results WHERE tenant_id = ? AND inspection_id = ?', TENANT, id);
const recorded = (key: string): Promise<number> => count('SELECT count(*) AS n FROM offline_import_applied WHERE tenant_id = ? AND idempotency_key = ?', TENANT, key);
const addressOf = async (id: string): Promise<string | null> =>
    (await b.DB.prepare('SELECT property_address AS a FROM inspections WHERE id = ?').bind(id).first<{ a: string }>())?.a ?? null;

function deviceState(): Uint8Array {
    const doc = new Y.Doc();
    seedResultsDoc(doc, [{ findingKey: KEY }]);
    applyItemPatch(doc, KEY, 'rating', 'RR');
    return Y.encodeStateAsUpdate(doc);
}

/** A package that creates `id` offline (no duration, no window). */
function createPackage(id: string, createKey: string, extra: Partial<PackageSpec> = {}): Uint8Array {
    return buildPackage({
        tenantId: TENANT, exportedBy: ownerId, inspections: [{ id, reportId: 'device-report' }],
        yjs: { [id]: deviceState() },
        outbox: [{ idempotencyKey: createKey, op: 'inspection.create', payload: { id, propertyAddress: `${id} Offline Road`, templateId: TEMPLATE, date: `${DAY}T10:00:00.000Z` } }],
        ...extra,
    });
}

const del = (id: string): Promise<Response> => call(`/api/inspections/${id}`, { method: 'DELETE', token: ownerJwt });

describe('deleting inspections and the native client', () => {
    beforeAll(async () => {
        await applyMigrations(b.DB, migrationSql);
        await b.DB.exec('CREATE TABLE IF NOT EXISTS test_queue_log (id TEXT PRIMARY KEY, type TEXT, body TEXT, received_at INTEGER);');
        const now = Date.now();
        await b.DB.prepare('INSERT OR IGNORE INTO tenants (id, slug, created_at) VALUES (?, ?, ?)').bind(TENANT, 'delete-import', now).run();
        await b.DB.prepare('INSERT OR IGNORE INTO templates (id, tenant_id, name, version, schema, created_at) VALUES (?, ?, ?, 1, ?, ?)')
            .bind(TEMPLATE, TENANT, 'Standard', JSON.stringify({ sections: [] }), now).run();
        ownerId = fresh('user-owner');
        await b.DB.prepare('INSERT INTO users (id, tenant_id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .bind(ownerId, TENANT, `${ownerId}@example.test`, 'x', ownerId, 'owner', now).run();
        nativeToken = `u:g:${ownerId}`;
        grants.set(nativeToken, { kind: 'native', userId: ownerId, tenantId: TENANT, role: 'owner', lastUsedAt: 0, grantedAt: 0 });
        const keyring = await buildKeyring(testEnv as never);
        ownerJwt = await signJwt({ sub: ownerId, role: 'owner', 'custom:userRole': 'owner', 'custom:tenantId': TENANT }, keyring);
    });

    it.each([['the single delete', 1], ['a batch delete (one request per id, as the list sends them)', 2]])(
        'a package that creates an inspection deleted by %s is refused whole with zero writes (control: a not-deleted one replays as skipped)',
        async (_name, howMany) => {
            const ids = Array.from({ length: howMany }, () => fresh('insp-del'));
            const keys = ids.map(() => fresh('k'));
            const zips = ids.map((id, i) => createPackage(id, keys[i]!));
            for (const zip of zips) {
                const first = await importZip(zip);
                expect(first.status, await first.clone().text()).toBe(200);
            }
            const keep = fresh('insp-keep');
            const keepKey = fresh('k');
            const keepZip = createPackage(keep, keepKey);
            expect((await importZip(keepZip)).status).toBe(200);

            for (const id of ids) {
                const gone = await del(id);
                expect(gone.status, await gone.clone().text()).toBe(200);
                expect(await addressOf(id)).toBeNull();
            }
            // Deleting again is "already gone", not a failure of the route the list calls.
            expect([200, 404]).toContain((await del(ids[0]!)).status);

            const before = { inspections: await inspectionRows(), results: await Promise.all(ids.map(resultRows)), records: await Promise.all(keys.map(recorded)) };
            expect(before.records).toEqual(keys.map(() => 1));

            for (const [i, zip] of zips.entries()) {
                const again = await importZip(zip);
                expect(again.status, await again.clone().text()).toBe(409);
                const text = await again.text();
                expect(text).toContain('PACKAGE_INSPECTION_DELETED');
                expect(text).toContain(ids[i]!);
            }
            // Zero writes: nothing came back, no results, and the applied record is untouched.
            expect(await inspectionRows()).toBe(before.inspections);
            expect(await Promise.all(ids.map(resultRows))).toEqual(before.results);
            expect(await Promise.all(keys.map(recorded))).toEqual(before.records);
            for (const id of ids) expect(await addressOf(id)).toBeNull();

            // Positive control: the inspection that was not deleted still replays, skipped.
            const replay = await importZip(keepZip);
            expect(replay.status, await replay.clone().text()).toBe(200);
            expect((await asJson(replay)).data?.outbox).toEqual({ applied: 0, skipped: 1, failed: [] });
            expect(await recorded(keepKey)).toBe(1);
        },
    );

    it('a package that creates an inspection created over the API and then deleted is refused whole (control: a never-created id imports)', async () => {
        // No import ever recorded this create, so only the tombstone can tell the importer the id was deleted.
        const id = fresh('insp-rest');
        const made = await call('/api/inspections', {
            method: 'POST', token: ownerJwt, headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id, propertyAddress: `${id} Road`, templateId: TEMPLATE, date: `${DAY}T10:00:00.000Z` }),
        });
        expect(made.status, await made.clone().text()).toBe(201);
        expect((await del(id)).status).toBe(200);
        const key = fresh('k');
        const before = await inspectionRows();

        const refused = await importZip(createPackage(id, key));
        expect(refused.status, await refused.clone().text()).toBe(409);
        expect(await refused.text()).toContain('PACKAGE_INSPECTION_DELETED');
        expect(await inspectionRows()).toBe(before);
        expect(await addressOf(id)).toBeNull();
        expect(await recorded(key)).toBe(0);

        // Control: an id nobody created or deleted imports as usual.
        const fine = fresh('insp-fine');
        const ok = await importZip(createPackage(fine, fresh('k')));
        expect(ok.status, await ok.clone().text()).toBe(200);
        expect(await addressOf(fine)).not.toBeNull();
    });

    it('a tombstone for an inspection that still exists (a delete that failed half way) does not refuse the package', async () => {
        const id = fresh('insp-half');
        const key = fresh('k');
        const zip = createPackage(id, key);
        expect((await importZip(zip)).status).toBe(200);
        await b.DB.prepare('INSERT INTO inspection_tombstones (tenant_id, inspection_id, deleted_at) VALUES (?, ?, ?)').bind(TENANT, id, Date.now()).run();
        const again = await importZip(zip);
        expect(again.status, await again.clone().text()).toBe(200);
        // Control: once the delete really finishes, the same package is refused.
        expect((await del(id)).status).toBe(200);
        const refused = await importZip(zip);
        expect(refused.status).toBe(409);
        expect(await refused.text()).toContain('PACKAGE_INSPECTION_DELETED');
    });

    it('replaying an inspection.update for a deleted inspection does not recreate it (control: the same update applies while it exists)', async () => {
        const id = fresh('insp-upd');
        expect((await importZip(createPackage(id, fresh('k')))).status).toBe(200);
        const report = await b.DB.prepare('SELECT id FROM reports WHERE inspection_id = ? AND tenant_id = ?').bind(id, TENANT).first<{ id: string }>();
        const update = (address: string): Uint8Array => buildPackage({
            tenantId: TENANT, exportedBy: ownerId, inspections: [{ id, reportId: report!.id }], yjs: { [id]: deviceState() },
            outbox: [{ idempotencyKey: fresh('k'), op: 'inspection.update', payload: { id, propertyAddress: address } }],
        });
        const live = await importZip(update('1 Updated While Alive Road'));
        expect(live.status, await live.clone().text()).toBe(200);
        expect(await addressOf(id)).toBe('1 Updated While Alive Road');

        expect((await del(id)).status).toBe(200);
        const count0 = await inspectionRows();
        const replay = await importZip(update('2 Must Not Come Back Road'));
        expect(replay.status, await replay.clone().text()).not.toBe(200);
        expect(await addressOf(id)).toBeNull();
        expect(await inspectionRows()).toBe(count0);
        expect(await resultRows(id)).toBe(0);
    });

    it('an imported create with no duration and an update onto an existing inspection are applied, and the conflict query copes with both', async () => {
        const first = fresh('insp-first');
        const second = fresh('insp-second');
        expect((await importZip(createPackage(first, fresh('k')))).status).toBe(200);
        // The second inspection is created for another day, then moved onto the first one's slot by an offline update.
        const zip = buildPackage({
            tenantId: TENANT, exportedBy: ownerId, inspections: [{ id: second, reportId: 'device-report' }], yjs: { [second]: deviceState() },
            outbox: [
                { idempotencyKey: fresh('k'), op: 'inspection.create', payload: { id: second, propertyAddress: 'Second Offline Road', templateId: TEMPLATE, date: '2026-10-09T10:00:00.000Z' } },
                { idempotencyKey: fresh('k'), op: 'inspection.update', payload: { id: second, date: `${DAY}T10:00:00.000Z` } },
            ],
        });
        const res = await importZip(zip);
        expect(res.status, await res.clone().text()).toBe(200);
        expect((await asJson(res)).data?.outbox).toEqual({ applied: 2, skipped: 0, failed: [] });
        const rows = await b.DB.prepare('SELECT id, date, duration_min AS d, scheduled_start_ms AS s FROM inspections WHERE id IN (?, ?)').bind(first, second).all<{ id: string; date: string; d: number | null; s: number | null }>();
        expect(rows.results).toHaveLength(2);
        expect(rows.results.every((r) => r.d === null)).toBe(true);
        expect(rows.results.every((r) => r.date.startsWith(DAY))).toBe(true);

        // Both sit on the same slot with no recorded window; the conflict query lists them rather than failing.
        const conflicts = await call(`/api/calendar/blocks/conflicts?date=${DAY}&allDay=true`, { token: ownerJwt });
        expect(conflicts.status, await conflicts.clone().text()).toBe(200);
        const list = ((await conflicts.json()) as { data: { conflicts: Array<{ id: string }> } }).data.conflicts.map((c) => c.id);
        expect(list).toEqual(expect.arrayContaining([first, second]));
    });

    it('GET /api/inspections/:id still returns the template snapshot the native editor reads', async () => {
        const id = fresh('insp-snap');
        expect((await importZip(createPackage(id, fresh('k')))).status).toBe(200);
        const res = await call(`/api/inspections/${id}`, { token: ownerJwt });
        expect(res.status, await res.clone().text()).toBe(200);
        const data = ((await res.json()) as { data: { inspection: Record<string, unknown> } }).data;
        expect(data.inspection).toHaveProperty('templateSnapshot');
        expect(data.inspection.templateSnapshot).toBeTruthy();
    });
});
