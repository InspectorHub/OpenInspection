/**
 * A create that names the id of a deleted inspection is refused (409 INSPECTION_ID_DELETED).
 *
 * The id was minted by the client, so a queued create can be replayed long after the inspection was
 * deleted. The deletes here go through the real DELETE /api/inspections/:id route. Every refusal is
 * paired with a positive control; the tombstone is per company.
 */
import { env as testEnv } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import app from '../../../server/index';
import { buildKeyring, signJwt } from '../../../server/lib/jwt-keyring';
import { applyMigrations } from '../migration-replay';

const migrationSql = import.meta.glob('../../../migrations/*.sql', {
    query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;
const b = testEnv as unknown as { DB: D1Database };

const TENANT = 'delete-create-tenant';
const OTHER = 'delete-create-other';
const TEMPLATE = 'delete-create-template';

const pending: Promise<unknown>[] = [];
const ctx = { waitUntil: (p: Promise<unknown>) => { pending.push(p); }, passThroughOnException: () => undefined } as unknown as ExecutionContext;

async function call(path: string, init: RequestInit = {}): Promise<Response> {
    const res = await app.fetch(new Request(`http://x${path}`, init), testEnv as never, ctx);
    await Promise.all(pending.splice(0));
    return res;
}

let seq = 0;
const fresh = (p: string): string => `${p}-${++seq}-${crypto.randomUUID().slice(0, 6)}`;
const jwts: Record<string, string> = {};

async function seedTenant(tenantId: string, slug: string): Promise<void> {
    const now = Date.now();
    await b.DB.prepare('INSERT OR IGNORE INTO tenants (id, slug, created_at) VALUES (?, ?, ?)').bind(tenantId, slug, now).run();
    await b.DB.prepare('INSERT OR IGNORE INTO templates (id, tenant_id, name, version, schema, created_at) VALUES (?, ?, ?, 1, ?, ?)')
        .bind(`${TEMPLATE}-${tenantId}`, tenantId, 'Standard', JSON.stringify({ sections: [] }), now).run();
    const userId = `user-${tenantId}`;
    await b.DB.prepare('INSERT OR IGNORE INTO users (id, tenant_id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(userId, tenantId, `${userId}@example.test`, 'x', userId, 'owner', now).run();
    jwts[tenantId] = await signJwt({ sub: userId, role: 'owner', 'custom:userRole': 'owner', 'custom:tenantId': tenantId }, await buildKeyring(testEnv as never));
}

const auth = (tenantId: string, extra: Record<string, string> = {}): Record<string, string> => ({ authorization: `Bearer ${jwts[tenantId]}`, ...extra });
const create = (tenantId: string, id: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}): Promise<Response> =>
    call('/api/inspections', {
        method: 'POST', headers: auth(tenantId, { 'content-type': 'application/json', ...headers }),
        body: JSON.stringify({ id, propertyAddress: `${id} Road`, templateId: `${TEMPLATE}-${tenantId}`, date: '2026-10-02T10:00:00.000Z', ...extra }),
    });
const del = (tenantId: string, id: string): Promise<Response> => call(`/api/inspections/${id}`, { method: 'DELETE', headers: auth(tenantId) });
const count = async (sql: string, ...args: unknown[]): Promise<number> =>
    (await b.DB.prepare(sql).bind(...args).first<{ n: number }>())?.n ?? 0;
const inspectionRows = (id: string): Promise<number> => count('SELECT count(*) AS n FROM inspections WHERE id = ?', id);
const tombstoneRows = (tenantId: string, id: string): Promise<number> =>
    count('SELECT count(*) AS n FROM inspection_tombstones WHERE tenant_id = ? AND inspection_id = ?', tenantId, id);
const errorOf = async (res: Response): Promise<{ code?: string; details?: { inspectionId?: string } }> =>
    ((await res.json()) as { error?: { code?: string; details?: { inspectionId?: string } } }).error ?? {};

describe('creating an inspection with the id of one that was deleted', () => {
    beforeAll(async () => {
        await applyMigrations(b.DB, migrationSql);
        await b.DB.exec('CREATE TABLE IF NOT EXISTS test_queue_log (id TEXT PRIMARY KEY, type TEXT, body TEXT, received_at INTEGER);');
        await seedTenant(TENANT, 'delete-create');
        await seedTenant(OTHER, 'delete-create-other');
    });

    it('answers 409 INSPECTION_ID_DELETED and writes nothing (control: a live id replays as 200, a new id creates)', async () => {
        const id = fresh('insp-gone');
        const first = await create(TENANT, id);
        expect(first.status, await first.clone().text()).toBe(201);
        // Control: while the row exists a replay is the existing 200 answer.
        expect((await create(TENANT, id)).status).toBe(200);
        expect((await del(TENANT, id)).status).toBe(200);
        expect(await tombstoneRows(TENANT, id)).toBe(1);

        const again = await create(TENANT, id);
        expect(again.status).toBe(409);
        const err = await errorOf(again);
        expect(err.code).toBe('INSPECTION_ID_DELETED');
        expect(err.details?.inspectionId).toBe(id);
        expect(await inspectionRows(id)).toBe(0);
        expect(await count('SELECT count(*) AS n FROM inspection_results WHERE inspection_id = ?', id)).toBe(0);
        expect(await count('SELECT count(*) AS n FROM reports WHERE inspection_id = ?', id)).toBe(0);

        // The same refusal when the request names contacts.
        const withClient = await create(TENANT, id, { client: { name: 'Jane Client', email: 'jane@example.test' } });
        expect(withClient.status).toBe(409);
        expect((await errorOf(withClient)).code).toBe('INSPECTION_ID_DELETED');

        // Control: a different id is created.
        expect((await create(TENANT, fresh('insp-new'))).status).toBe(201);
    });

    it("another company's deleted id does not block this company", async () => {
        const id = fresh('insp-shared-id');
        expect((await create(OTHER, id)).status).toBe(201);
        expect((await del(OTHER, id)).status).toBe(200);
        expect(await tombstoneRows(OTHER, id)).toBe(1);
        expect(await tombstoneRows(TENANT, id)).toBe(0);

        const mine = await create(TENANT, id);
        expect(mine.status, await mine.clone().text()).toBe(201);
        // Control: the company that deleted it is refused.
        const theirs = await create(OTHER, id);
        expect(theirs.status).toBe(409);
        expect((await errorOf(theirs)).code).toBe('INSPECTION_ID_DELETED');
    });

    it('a replay with an Idempotency-Key inside its 24 hour window still gets the stored 2xx (existing behaviour)', async () => {
        const id = fresh('insp-keyed');
        const key = fresh('idem');
        const first = await create(TENANT, id, {}, { 'idempotency-key': key });
        expect(first.status, await first.clone().text()).toBe(201);
        expect((await del(TENANT, id)).status).toBe(200);
        const replay = await create(TENANT, id, {}, { 'idempotency-key': key });
        expect(replay.status).toBe(201);
        expect(replay.headers.get('idempotency-replayed')).toBe('true');
        // Control: without the key the refusal stands.
        expect((await create(TENANT, id)).status).toBe(409);
        expect(await inspectionRows(id)).toBe(0);
    });

    it('a PATCH to a deleted id is still the existing 404', async () => {
        const id = fresh('insp-patch');
        expect((await create(TENANT, id)).status).toBe(201);
        expect((await del(TENANT, id)).status).toBe(200);
        const res = await call(`/api/inspections/${id}`, {
            method: 'PATCH', headers: auth(TENANT, { 'content-type': 'application/json' }), body: JSON.stringify({ propertyAddress: '2 Edited Road' }),
        });
        expect(res.status).toBe(404);
    });

    it('refuses the delete and keeps the inspection when the tombstone cannot be written', async () => {
        const id = fresh('insp-keep');
        expect((await create(TENANT, id)).status).toBe(201);
        await b.DB.exec('ALTER TABLE inspection_tombstones RENAME TO inspection_tombstones_held');
        try {
            const res = await del(TENANT, id);
            expect(res.status).toBeGreaterThanOrEqual(500);
            expect(await inspectionRows(id)).toBe(1);
        } finally {
            await b.DB.exec('ALTER TABLE inspection_tombstones_held RENAME TO inspection_tombstones');
        }
        // Control: with the table back the delete goes through.
        expect((await del(TENANT, id)).status).toBe(200);
        expect(await inspectionRows(id)).toBe(0);
    });
});
