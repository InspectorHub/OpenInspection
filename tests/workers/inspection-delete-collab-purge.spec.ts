/**
 * Deleting an inspection empties the collaborative-document storage of its
 * reports (workerd).
 *
 * What is real: the Hono app and its middleware chain, D1 with the real
 * migrations, and the collab Durable Objects, so "the storage is empty" is read
 * from the object itself. Every refusal is paired with a positive control.
 */
import { env as testEnv, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { collabDocName } from '../../server/lib/collab/doc-name';
import type { InspectionDocDO } from '../../server/durable-objects/inspection-doc';
import { logger } from '../../server/lib/logger';
import { applyMigrations } from './migration-replay';
import app from '../../server/index';
import { buildKeyring, signJwt } from '../../server/lib/jwt-keyring';

const migrationSql = import.meta.glob('../../migrations/*.sql', {
    query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

interface TestBindings {
    DB: D1Database;
    PHOTOS: R2Bucket;
    INSPECTION_DOC: DurableObjectNamespace<InspectionDocDO>;
}
const b = testEnv as unknown as TestBindings;

const TENANT = 'collab-purge-tenant';
const OTHER_TENANT = 'collab-purge-other-tenant';
const TEMPLATE = 'collab-purge-template';
const OWNER_ID = 'collab-purge-owner';

let ownerJwt = '';
let seq = 0;

const pending: Promise<unknown>[] = [];
const ctx = {
    waitUntil: (p: Promise<unknown>) => { pending.push(p); },
    passThroughOnException: () => undefined,
} as unknown as ExecutionContext;

async function call(path: string, init: RequestInit & { env?: Record<string, unknown> } = {}): Promise<Response> {
    const { env: extraEnv, ...rest } = init;
    const headers = new Headers(rest.headers);
    headers.set('authorization', `Bearer ${ownerJwt}`);
    const res = await app.fetch(new Request(`http://x${path}`, { ...rest, headers }), { ...testEnv, ...extraEnv } as never, ctx);
    await Promise.all(pending.splice(0));
    return res;
}

interface Created { id: string; reportIds: string[] }

async function createInspection(): Promise<Created> {
    const id = `insp-${++seq}-${crypto.randomUUID().slice(0, 6)}`;
    const res = await call('/api/inspections', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, propertyAddress: '1 Purge Road, Anytown', templateId: TEMPLATE, date: '2026-10-01T10:00:00.000Z' }),
    });
    expect(res.status, await res.clone().text()).toBe(201);
    const rows = await b.DB.prepare('SELECT id FROM reports WHERE inspection_id = ? AND tenant_id = ?').bind(id, TENANT).all<{ id: string }>();
    return { id, reportIds: rows.results.map((r) => r.id) };
}

/** A second report on the same inspection, so the purge has two objects to reach. */
async function addReport(insp: Created): Promise<string> {
    const reportId = `rep-extra-${++seq}`;
    await b.DB.prepare('INSERT INTO reports (id, tenant_id, inspection_id, kind, title, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(reportId, TENANT, insp.id, 'secondary', 'Second', 'draft', Date.now()).run();
    insp.reportIds.push(reportId);
    return reportId;
}

const stubFor = (name: string): DurableObjectStub<InspectionDocDO> => b.INSPECTION_DOC.get(b.INSPECTION_DOC.idFromName(name));

async function writeMarker(name: string): Promise<void> {
    await runInDurableObject(stubFor(name), async (_i: InspectionDocDO, state) => { await state.storage.put('marker', 'report prose'); });
}

async function storedKeys(name: string): Promise<string[]> {
    return runInDurableObject(stubFor(name), async (_i: InspectionDocDO, state) => [...(await state.storage.list()).keys()]);
}

async function inspectionExists(id: string): Promise<boolean> {
    return !!(await b.DB.prepare('SELECT id FROM inspections WHERE id = ?').bind(id).first());
}

async function deleteAuditMeta(id: string): Promise<Record<string, unknown>> {
    const row = await b.DB.prepare("SELECT metadata FROM audit_logs WHERE tenant_id = ? AND action = 'inspection.delete' AND entity_id = ?")
        .bind(TENANT, id).first<{ metadata: string | null }>();
    expect(row, 'the delete must be audited').not.toBeNull();
    return JSON.parse(row!.metadata ?? '{}') as Record<string, unknown>;
}

describe('DELETE /api/inspections/:id and collaborative document storage', () => {
    beforeAll(async () => {
        await applyMigrations(b.DB, migrationSql);
        await b.DB.exec('CREATE TABLE IF NOT EXISTS test_queue_log (id TEXT PRIMARY KEY, type TEXT, body TEXT, received_at INTEGER);');
        const now = Date.now();
        await b.DB.prepare('INSERT OR IGNORE INTO tenants (id, slug, created_at) VALUES (?, ?, ?)').bind(TENANT, 'collab-purge', now).run();
        await b.DB.prepare('INSERT OR IGNORE INTO templates (id, tenant_id, name, version, schema, created_at) VALUES (?, ?, ?, 1, ?, ?)')
            .bind(TEMPLATE, TENANT, 'Standard', JSON.stringify({ sections: [] }), now).run();
        await b.DB.prepare('INSERT INTO users (id, tenant_id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .bind(OWNER_ID, TENANT, `${OWNER_ID}@example.test`, 'x', 'Owner', 'owner', now).run();
        ownerJwt = await signJwt({ sub: OWNER_ID, role: 'owner', 'custom:userRole': 'owner', 'custom:tenantId': TENANT }, await buildKeyring(testEnv as never));
    });

    afterEach(() => { vi.restoreAllMocks(); });

    it('empties the object of every report of the deleted inspection and nothing else (positive control: the content was there first)', async () => {
        const target = await createInspection();
        await addReport(target);
        const sibling = await createInspection();
        expect(target.reportIds).toHaveLength(2);

        const targetNames = target.reportIds.map((r) => collabDocName(TENANT, r));
        const siblingName = collabDocName(TENANT, sibling.reportIds[0]!);
        // The same report id under another tenant is a different object.
        const otherTenantName = collabDocName(OTHER_TENANT, target.reportIds[0]!);
        for (const name of [...targetNames, siblingName, otherTenantName]) await writeMarker(name);
        for (const name of [...targetNames, siblingName, otherTenantName]) expect(await storedKeys(name)).toContain('marker');

        const res = await call(`/api/inspections/${target.id}`, { method: 'DELETE' });
        expect(res.status, await res.clone().text()).toBe(200);
        expect(await inspectionExists(target.id)).toBe(false);

        for (const name of targetNames) expect(await storedKeys(name), name).toEqual([]);
        expect(await storedKeys(siblingName)).toContain('marker');
        expect(await storedKeys(otherTenantName)).toContain('marker');
        expect((await deleteAuditMeta(target.id)).collabPurge).toBe('ok');
    });

    it('a purge that cannot reach the object does not fail the delete: HTTP 200, inspection gone, a warning with the inspection id, collabPurge failed', async () => {
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
        const insp = await createInspection();
        const broken = {
            idFromName: (n: string) => n,
            get: () => ({ fetch: async () => { throw new Error('storage unavailable'); } }),
        } as unknown as DurableObjectNamespace;

        const res = await call(`/api/inspections/${insp.id}`, { method: 'DELETE', env: { INSPECTION_DOC: broken } });
        expect(res.status, await res.clone().text()).toBe(200);
        expect(await inspectionExists(insp.id)).toBe(false);
        const calls = warn.mock.calls.filter(([message]) => /collab/i.test(String(message)));
        expect(calls).toHaveLength(1);
        expect(calls[0]![1]).toMatchObject({ tenantId: TENANT, inspectionId: insp.id });
        expect((await deleteAuditMeta(insp.id)).collabPurge).toBe('failed');
    });

    it('a deployment without the collab binding deletes normally and records skipped', async () => {
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
        const insp = await createInspection();
        const res = await call(`/api/inspections/${insp.id}`, { method: 'DELETE', env: { INSPECTION_DOC: undefined } });
        expect(res.status, await res.clone().text()).toBe(200);
        expect(await inspectionExists(insp.id)).toBe(false);
        expect(warn.mock.calls.filter(([message]) => /collab/i.test(String(message)))).toEqual([]);
        expect((await deleteAuditMeta(insp.id)).collabPurge).toBe('skipped');
    });
});
