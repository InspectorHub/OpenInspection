/**
 * What an offline import does with a queued write that sets money when the
 * importer lacks the `financial` capability.
 *
 * A queued update is replayed through the same PATCH route a live edit uses, so
 * the money guard answers 403 FINANCIAL_REQUIRED for it. The import is
 * per-entry for updates: the refused write is REPORTED in `outbox.failed` and
 * the other queued writes (and the field results) still apply. A queued CREATE
 * that carries money is different: creates run first and a refusal stops the
 * request (a 403 whose details name the entry), so nothing is written and the
 * package stays on the device.
 *
 * Every refusal is paired with the same package imported by a member who holds
 * the capability, so a harness that rejects everything cannot pass.
 */
import { env as testEnv } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import * as Y from 'yjs';
import app from '../../../server/index';
import { NATIVE_SCOPE, type NativeProps } from '../../../server/lib/auth/native-token';
import { seedResultsDoc, applyItemPatch } from '../../../server/lib/collab/results-doc';
import type { InspectionDocDO } from '../../../server/durable-objects/inspection-doc';
import { applyMigrations } from '../migration-replay';
import { buildPackage } from '../../unit/helpers/offline-package-fixture';

const migrationSql = import.meta.glob('../../../migrations/*.sql', {
    query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

interface TestBindings { DB: D1Database; PHOTOS: R2Bucket; INSPECTION_DOC: DurableObjectNamespace<InspectionDocDO> }
const b = testEnv as unknown as TestBindings;

const TENANT = 'fin-import-tenant';
const TEMPLATE = 'fin-import-template';
const KEY = '_default:sec1:item1';

interface Member { id: string; token: string }
const grants = new Map<string, NativeProps>();
let seq = 0;
const fresh = (prefix: string): string => `${prefix}-${++seq}-${crypto.randomUUID().slice(0, 6)}`;
const provider = {
    unwrapToken: async (t: string) => {
        const props = grants.get(t);
        return props ? { scope: [NATIVE_SCOPE], grant: { clientId: 'c', scope: [NATIVE_SCOPE], props } } : null;
    },
};

async function addMember(role: 'manager' | 'inspector'): Promise<Member> {
    const id = fresh(`user-${role}`);
    await b.DB.prepare('INSERT INTO users (id, tenant_id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(id, TENANT, `${id}@example.test`, 'x', id, role, Date.now()).run();
    const token = `u:g:${id}`;
    grants.set(token, { kind: 'native', userId: id, tenantId: TENANT, role, lastUsedAt: 0, grantedAt: 0 });
    return { id, token };
}

const pending: Promise<unknown>[] = [];
const ctx = {
    waitUntil: (p: Promise<unknown>) => { pending.push(p); },
    passThroughOnException: () => undefined,
} as unknown as ExecutionContext;

async function call(path: string, init: RequestInit & { token: string }): Promise<Response> {
    const { token, ...rest } = init;
    const headers = new Headers(rest.headers);
    headers.set('authorization', `Bearer ${token}`);
    const env = { ...testEnv, NATIVE_CLIENT_ENABLED: 'true', OAUTH_PROVIDER: provider };
    const res = await app.fetch(new Request(`http://x${path}`, { ...rest, headers }), env as never, ctx);
    await Promise.all(pending.splice(0));
    return res;
}

async function createInspection(by: Member, address: string): Promise<{ id: string; reportId: string }> {
    const id = fresh('insp');
    const res = await call('/api/inspections', {
        method: 'POST', token: by.token, headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, propertyAddress: address, templateId: TEMPLATE, date: '2026-10-01T10:00:00.000Z' }),
    });
    expect(res.status, await res.clone().text()).toBe(201);
    const row = await b.DB.prepare('SELECT id FROM reports WHERE inspection_id = ? AND tenant_id = ?').bind(id, TENANT).first<{ id: string }>();
    return { id, reportId: row!.id };
}

function deviceState(): Uint8Array {
    const doc = new Y.Doc();
    seedResultsDoc(doc, [{ findingKey: KEY }]);
    applyItemPatch(doc, KEY, 'rating', 'RR');
    return Y.encodeStateAsUpdate(doc);
}

async function rowOf(id: string): Promise<{ price: number; address: string } | null> {
    const r = await b.DB.prepare('SELECT price_cents AS price, property_address AS address FROM inspections WHERE id = ?')
        .bind(id).first<{ price: number; address: string }>();
    return r ?? null;
}

interface ImportBody {
    data?: { outbox: { applied: number; failed: Array<{ op: string; status: number }> } };
    error?: { code: string };
}

function importUpdates(by: Member, insp: { id: string; reportId: string }, updates: Array<Record<string, unknown>>) {
    const zip = buildPackage({
        tenantId: TENANT, exportedBy: by.id,
        inspections: [{ id: insp.id, reportId: insp.reportId }],
        yjs: { [insp.id]: deviceState() },
        outbox: updates.map((u) => ({ idempotencyKey: fresh('k'), op: 'inspection.update', payload: { id: insp.id, ...u } })),
    });
    return call('/api/client/import', {
        method: 'POST', token: by.token,
        headers: { 'content-type': 'application/zip', 'content-length': String(zip.byteLength) },
        body: new Uint8Array(zip),
    });
}

describe('offline import and the financial capability', () => {
    let manager: Member;
    let inspector: Member;

    beforeAll(async () => {
        await applyMigrations(b.DB, migrationSql);
        await b.DB.exec('CREATE TABLE IF NOT EXISTS test_queue_log (id TEXT PRIMARY KEY, type TEXT, body TEXT, received_at INTEGER);');
        const now = Date.now();
        await b.DB.prepare('INSERT OR IGNORE INTO tenants (id, slug, created_at) VALUES (?, ?, ?)').bind(TENANT, TENANT, now).run();
        await b.DB.prepare('INSERT OR IGNORE INTO templates (id, tenant_id, name, version, schema, created_at) VALUES (?, ?, ?, 1, ?, ?)')
            .bind(TEMPLATE, TENANT, 'Standard', JSON.stringify({ sections: [] }), now).run();
        manager = await addMember('manager');
        inspector = await addMember('inspector');
    });

    it('reports a queued price change as refused and still applies the ordinary write beside it', async () => {
        const insp = await createInspection(inspector, '1 Original Road, Anytown');
        const res = await importUpdates(inspector, insp, [{ price: 99_000 }, { propertyAddress: '2 Changed Road, Anytown' }]);
        expect(res.status, await res.clone().text()).toBe(200);
        const out = ((await res.json()) as ImportBody).data!.outbox;
        expect(out.applied).toBe(1);
        expect(out.failed).toHaveLength(1);
        expect(out.failed[0]).toMatchObject({ op: 'inspection.update', status: 403 });
        expect(await rowOf(insp.id)).toEqual({ price: 0, address: '2 Changed Road, Anytown' });
    });

    it('positive control: a member who holds financial has both writes applied', async () => {
        const insp = await createInspection(manager, '3 Original Road, Anytown');
        const res = await importUpdates(manager, insp, [{ price: 99_000 }, { propertyAddress: '4 Changed Road, Anytown' }]);
        expect(res.status, await res.clone().text()).toBe(200);
        const out = ((await res.json()) as ImportBody).data!.outbox;
        expect(out).toMatchObject({ applied: 2, failed: [] });
        expect(await rowOf(insp.id)).toEqual({ price: 99_000, address: '4 Changed Road, Anytown' });
    });

    it('a queued create that sets a price stops the import with a 403 naming the refused write, and writes nothing', async () => {
        const create = (by: Member, price?: number) => {
            const id = fresh('insp-new');
            const zip = buildPackage({
                tenantId: TENANT, exportedBy: by.id,
                // A device cannot know the server's report id for an inspection it created.
                inspections: [{ id, reportId: 'device-report' }],
                yjs: { [id]: deviceState() },
                outbox: [{
                    idempotencyKey: fresh('k'), op: 'inspection.create',
                    payload: { id, propertyAddress: '5 Created Road, Anytown', templateId: TEMPLATE, date: '2026-10-01T10:00:00.000Z', ...(price === undefined ? {} : { price }) },
                }],
            });
            return { id, send: () => call('/api/client/import', {
                method: 'POST', token: by.token,
                headers: { 'content-type': 'application/zip', 'content-length': String(zip.byteLength) },
                body: new Uint8Array(zip),
            }) };
        };
        const refused = create(inspector, 12_000);
        const res = await refused.send();
        expect(res.status, await res.clone().text()).toBe(403);
        // The importer re-labels a replayed refusal as a plain forbidden; `details` names the entry and the status.
        const error = ((await res.json()) as { error: { code: string; details: { op: string; status: number } } }).error;
        expect(error.code).toBe('forbidden');
        expect(error.details).toMatchObject({ op: 'inspection.create', status: 403 });
        expect(await rowOf(refused.id)).toBeNull();

        // Controls: the same create without money imports for the inspector, and with money for a manager.
        const free = create(inspector);
        expect((await free.send()).status).toBe(200);
        expect(await rowOf(free.id)).toMatchObject({ price: 0 });
        const paid = create(manager, 12_000);
        expect((await paid.send()).status).toBe(200);
        // (The create route does not store the body's price - it derives it from the services - so only the status is asserted.)
        expect(await rowOf(paid.id)).not.toBeNull();
    });
});
