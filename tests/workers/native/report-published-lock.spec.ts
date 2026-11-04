/**
 * What a published report does to the native client's offline edits.
 *
 * Content may not change silently after publish, so an offline package that carries edits for a published report is
 * refused WHOLE with 409 `REPORT_PUBLISHED` and `details.inspectionId(s)`: nothing is written and nothing is
 * recorded as applied, so the device still holds every edit and can ask the person ("Report is published. Update and
 * republish?"). After "Edit and republish" the very same package imports. The same rule answers the HTTP writes
 * the editor and the outbox use, and a socket is closed with 4409 (see collab-report-lock.spec.ts).
 *
 * Every refusal is paired with a positive control on the same inspection.
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


const publishedAt = Date.now();
const setPublished = async (id: string): Promise<unknown> => {
    await b.DB.prepare("UPDATE inspections SET report_status = 'published' WHERE id = ? AND tenant_id = ?").bind(id, TENANT).run();
    return b.DB.prepare("UPDATE reports SET status = 'published', published_at = ? WHERE inspection_id = ? AND tenant_id = ?").bind(publishedAt, id, TENANT).run();
};
const rating = async (id: string): Promise<string | null> => {
    const row = await b.DB.prepare('SELECT data FROM inspection_results WHERE inspection_id = ? AND tenant_id = ?').bind(id, TENANT).first<{ data: string }>();
    return row ? ((JSON.parse(row.data) as Record<string, { rating?: string }>)[KEY]?.rating ?? null) : null;
};
const editAgain = (id: string): Promise<Response> =>
    call(`/api/inspections/${id}/edit-again`, { method: 'POST', token: ownerJwt, headers: { 'content-type': 'application/json' }, body: '{}' });

describe('a published report and offline edits', () => {
    beforeAll(async () => {
        await applyMigrations(b.DB, migrationSql);
        await b.DB.exec('CREATE TABLE IF NOT EXISTS test_queue_log (id TEXT PRIMARY KEY, type TEXT, body TEXT, received_at INTEGER);');
        const now = Date.now();
        await b.DB.prepare('INSERT OR IGNORE INTO tenants (id, slug, created_at) VALUES (?, ?, ?)').bind(TENANT, 'published-lock', now).run();
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

    /** An inspection created by an earlier package, with its server-side primary report id. */
    async function existing(): Promise<{ id: string; reportId: string }> {
        const id = fresh('insp-pub');
        expect((await importZip(createPackage(id, fresh('k')))).status).toBe(200);
        const report = await b.DB.prepare('SELECT id FROM reports WHERE inspection_id = ? AND tenant_id = ?').bind(id, TENANT).first<{ id: string }>();
        return { id, reportId: report!.id };
    }

    const editPackage = (id: string, reportId: string, rate: string): Uint8Array => {
        const doc = new Y.Doc();
        seedResultsDoc(doc, [{ findingKey: KEY }]);
        applyItemPatch(doc, KEY, 'rating', rate);
        return buildPackage({
            tenantId: TENANT, exportedBy: ownerId, inspections: [{ id, reportId }], yjs: { [id]: Y.encodeStateAsUpdate(doc) },
            outbox: [{ idempotencyKey: fresh('k'), op: 'inspection.update', payload: { id, propertyAddress: `${id} Edited Offline Road` } }],
        });
    };

    it('refuses a package for a published inspection whole (409 REPORT_PUBLISHED, zero writes), and imports the same package once the report is edited again', async () => {
        const { id, reportId } = await existing();
        const zip = editPackage(id, reportId, 'NI');
        await setPublished(id);
        const before = { rating: await rating(id), address: await addressOf(id), applied: await count('SELECT count(*) AS n FROM offline_import_applied WHERE tenant_id = ?', TENANT) };

        const refused = await importZip(zip);
        expect(refused.status, await refused.clone().text()).toBe(409);
        const body = (await refused.json()) as { error: { code: string; message: string; details: { inspectionId: string; inspectionIds: string[] } } };
        expect(body.error.code).toBe('REPORT_PUBLISHED');
        expect(body.error.message).toBe('Report is published. Update and republish?');
        expect(body.error.details).toEqual({ inspectionId: id, inspectionIds: [id] });
        // Zero writes: the results, the inspection and the applied records are exactly as they were.
        expect(await rating(id)).toBe(before.rating);
        expect(await addressOf(id)).toBe(before.address);
        expect(await count('SELECT count(*) AS n FROM offline_import_applied WHERE tenant_id = ?', TENANT)).toBe(before.applied);

        // Edit and republish lifts the lock; the device's package, unchanged, now applies.
        const reopened = await editAgain(id);
        expect(reopened.status, await reopened.clone().text()).toBe(200);
        const applied = await importZip(zip);
        expect(applied.status, await applied.clone().text()).toBe(200);
        expect(await addressOf(id)).toBe(`${id} Edited Offline Road`);
        // The device's document reached the results (it was refused before), and its queued write was applied.
        expect(((await applied.json()) as { data: { yjs: { changed: number }; outbox: { applied: number } } }).data).toMatchObject({ yjs: { changed: 1 }, outbox: { applied: 1 } });
    });

    it('names every published inspection of a package, so the device can send the rest', async () => {
        const one = await existing();
        const two = await existing();
        await setPublished(one.id);
        await setPublished(two.id);
        const doc = new Y.Doc();
        seedResultsDoc(doc, [{ findingKey: KEY }]);
        const zip = buildPackage({
            tenantId: TENANT, exportedBy: ownerId, inspections: [{ id: one.id, reportId: one.reportId }, { id: two.id, reportId: two.reportId }],
            yjs: { [one.id]: Y.encodeStateAsUpdate(doc), [two.id]: Y.encodeStateAsUpdate(doc) }, outbox: [],
        });
        const refused = await importZip(zip);
        expect(refused.status).toBe(409);
        const body = (await refused.json()) as { error: { details: { inspectionIds: string[] } } };
        expect([...body.error.details.inspectionIds].sort()).toEqual([one.id, two.id].sort());
    });

    it('a report an older retract left published, whose order is back in draft, is not locked: its package imports', async () => {
        const legacy = await existing();
        await setPublished(legacy.id);
        await b.DB.prepare("UPDATE inspections SET report_status = 'in_progress' WHERE id = ? AND tenant_id = ?").bind(legacy.id, TENANT).run();
        const ok = await importZip(editPackage(legacy.id, legacy.reportId, 'RR'));
        expect(ok.status, await ok.clone().text()).toBe(200);
        // Control: published on both records, the same package is refused.
        const real = await existing();
        await setPublished(real.id);
        expect((await importZip(editPackage(real.id, real.reportId, 'RR'))).status).toBe(409);
    });

    it('a published inspection does not stop a package for an unpublished one (control)', async () => {
        const published = await existing();
        const draft = await existing();
        await setPublished(published.id);
        const ok = await importZip(editPackage(draft.id, draft.reportId, 'RR'));
        expect(ok.status, await ok.clone().text()).toBe(200);
    });

    it('answers the HTTP content writes the editor and the outbox use with the same 409 (control: after edit again they succeed)', async () => {
        const { id } = await existing();
        await setPublished(id);
        const sign = (): Promise<Response> => call(`/api/inspections/${id}/inspector-signature`, {
            method: 'POST', token: ownerJwt, headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ signatureBase64: 'data:image/png;base64,' + 'A'.repeat(200), signedAt: Date.now() }),
        });
        const refused = await sign();
        expect(refused.status, await refused.clone().text()).toBe(409);
        expect(((await refused.json()) as { error: { code: string } }).error.code).toBe('REPORT_PUBLISHED');

        expect((await editAgain(id)).status).toBe(200);
        const ok = await sign();
        expect(ok.status, await ok.clone().text()).toBe(200);
    });

    it('an inspection.update queued in a package for a published inspection is refused with the package, not applied piecemeal', async () => {
        const { id, reportId } = await existing();
        await setPublished(id);
        const address = await addressOf(id);
        expect((await importZip(editPackage(id, reportId, 'NI'))).status).toBe(409);
        expect(await addressOf(id)).toBe(address);
    });
});
