/**
 * Importing an offline package from the web: the signed-in browser session
 * (the HttpOnly cookie, no Bearer, no native grant) calls `POST /api/client/import`.
 *
 * What is real: the Hono app and its middleware chain, D1 with the real
 * migrations, R2 and the results Durable Object. The environment is left as the
 * test pool provides it: `NATIVE_CLIENT_ENABLED` is NOT set and there is no OAuth
 * provider, which is what a deployment without the native client looks like. The
 * import must work there for a cookie session, because that switch governs native
 * tokens only.
 *
 * Every refusal is paired with a positive control (the same package imported by
 * someone allowed to) so a harness that rejects everything cannot pass.
 */
import { env as testEnv, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import * as Y from 'yjs';
import app from '../../../server/index';
import { buildKeyring, signJwt } from '../../../server/lib/jwt-keyring';
import { collabDocName } from '../../../server/lib/collab/doc-name';
import { seedResultsDoc, applyItemPatch, projectResults } from '@core/field-ui/shared/results-doc';
import { isNeverBlocked } from '../../../server/lib/native/client-version';
import type { InspectionDocDO } from '../../../server/durable-objects/inspection-doc';
import { applyMigrations } from '../migration-replay';
import { buildPackage, type PackageSpec } from '../../unit/helpers/offline-package-fixture';

const migrationSql = import.meta.glob('../../../migrations/*.sql', {
    query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

interface TestBindings {
    DB: D1Database;
    PHOTOS: R2Bucket;
    INSPECTION_DOC: DurableObjectNamespace<InspectionDocDO>;
}
const b = testEnv as unknown as TestBindings;

const TENANT = 'web-import-tenant';
const OTHER_TENANT = 'web-import-other';
const TEMPLATE = 'web-import-template';
const KEY = '_default:sec1:item1';

type Role = 'owner' | 'manager' | 'inspector' | 'staff' | 'agent';
interface Member { id: string; jwt: string; role: Role }

let seq = 0;
const fresh = (prefix: string): string => `${prefix}-${++seq}-${crypto.randomUUID().slice(0, 6)}`;
let keyring: Awaited<ReturnType<typeof buildKeyring>>;

async function addMember(role: Role, overrides: Record<string, boolean> | null = null): Promise<Member> {
    const id = fresh(`web-${role}`);
    await b.DB.prepare('INSERT INTO users (id, tenant_id, email, password_hash, name, role, permission_overrides, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, TENANT, `${id}@example.test`, 'x', id, role, overrides ? JSON.stringify(overrides) : null, Date.now()).run();
    const jwt = await signJwt({ sub: id, role, 'custom:userRole': role, 'custom:tenantId': TENANT }, keyring);
    return { id, jwt, role };
}

const pending: Promise<unknown>[] = [];
const ctx = {
    waitUntil: (p: Promise<unknown>) => { pending.push(p); },
    passThroughOnException: () => undefined,
} as unknown as ExecutionContext;

/** Calls the real app with the pool's own environment: no native switch, no OAuth provider. */
async function call(path: string, init: RequestInit = {}): Promise<Response> {
    const res = await app.fetch(new Request(`http://x${path}`, init), testEnv as never, ctx);
    await Promise.all(pending.splice(0));
    return res;
}

/** What a browser sends: the session cookie and nothing else (no Authorization, no CSRF header). */
function importAsBrowser(jwt: string | null, zip: Uint8Array): Promise<Response> {
    const headers = new Headers({ 'content-type': 'application/zip', 'content-length': String(zip.byteLength) });
    if (jwt) headers.set('cookie', `__Host-inspector_token=${jwt}`);
    return call('/api/client/import', { method: 'POST', headers, body: new Uint8Array(zip) });
}

interface Created { id: string; reportId: string }

async function createInspection(by: Member): Promise<Created> {
    const id = fresh('web-insp');
    const res = await call('/api/inspections', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${by.jwt}` },
        body: JSON.stringify({ id, propertyAddress: '1 Original Road, Anytown', templateId: TEMPLATE, date: '2026-10-01T10:00:00.000Z' }),
    });
    expect(res.status, await res.clone().text()).toBe(201);
    const row = await b.DB.prepare('SELECT id FROM reports WHERE inspection_id = ? AND tenant_id = ?').bind(id, TENANT).first<{ id: string }>();
    return { id, reportId: row!.id };
}

function deviceState(rating: string): Uint8Array {
    const doc = new Y.Doc();
    seedResultsDoc(doc, [{ findingKey: KEY }]);
    applyItemPatch(doc, KEY, 'rating', rating);
    return Y.encodeStateAsUpdate(doc);
}

async function ratingOf(insp: Created): Promise<string | undefined> {
    const stub = b.INSPECTION_DOC.get(b.INSPECTION_DOC.idFromName(collabDocName(TENANT, insp.reportId)));
    const projection = await runInDurableObject(stub, (instance: InspectionDocDO) =>
        projectResults((instance as unknown as { doc: Y.Doc }).doc));
    return projection[KEY]?.rating;
}

async function addressOf(id: string): Promise<string | null> {
    const row = await b.DB.prepare('SELECT property_address AS a FROM inspections WHERE id = ?').bind(id).first<{ a: string }>();
    return row?.a ?? null;
}

async function importRecords(): Promise<number> {
    const row = await b.DB.prepare('SELECT count(*) AS n FROM offline_import_applied WHERE tenant_id = ?').bind(TENANT).first<{ n: number }>();
    return row?.n ?? 0;
}

async function importAudits(): Promise<number> {
    const row = await b.DB.prepare("SELECT count(*) AS n FROM audit_logs WHERE tenant_id = ? AND action = 'native.offline_import'").bind(TENANT).first<{ n: number }>();
    return row?.n ?? 0;
}

function pkg(exportedBy: string, insp: Created, extra: Partial<PackageSpec> = {}): PackageSpec {
    return {
        tenantId: TENANT, exportedBy,
        inspections: [{ id: insp.id, reportId: insp.reportId }],
        yjs: { [insp.id]: deviceState('RR') },
        ...extra,
    };
}

async function errorOf(res: Response): Promise<{ code?: string; details?: Record<string, unknown> }> {
    return ((await res.json()) as { error: { code?: string; details?: Record<string, unknown> } }).error;
}

describe('POST /api/client/import with a web session cookie', () => {
    let owner: Member;
    let manager: Member;

    beforeAll(async () => {
        await applyMigrations(b.DB, migrationSql);
        await b.DB.exec('CREATE TABLE IF NOT EXISTS test_queue_log (id TEXT PRIMARY KEY, type TEXT, body TEXT, received_at INTEGER);');
        const now = Date.now();
        await b.DB.prepare('INSERT OR IGNORE INTO tenants (id, slug, created_at) VALUES (?, ?, ?)').bind(TENANT, TENANT, now).run();
        await b.DB.prepare('INSERT OR IGNORE INTO tenants (id, slug, created_at) VALUES (?, ?, ?)').bind(OTHER_TENANT, OTHER_TENANT, now).run();
        await b.DB.prepare('INSERT OR IGNORE INTO templates (id, tenant_id, name, version, schema, created_at) VALUES (?, ?, ?, 1, ?, ?)')
            .bind(TEMPLATE, TENANT, 'Standard', JSON.stringify({ sections: [] }), now).run();
        keyring = await buildKeyring(testEnv as never);
        owner = await addMember('owner');
        manager = await addMember('manager');
    });

    it('imports for a cookie session with the native switch unset, and a second import changes nothing', async () => {
        // The pool environment really has no native switch; this test means nothing otherwise.
        expect((testEnv as unknown as { NATIVE_CLIENT_ENABLED?: string }).NATIVE_CLIENT_ENABLED).toBeUndefined();

        const insp = await createInspection(owner);
        const zip = buildPackage(pkg(owner.id, insp, {
            outbox: [{ idempotencyKey: fresh('k'), op: 'inspection.update', payload: { id: insp.id, propertyAddress: '8 Web Import Way, Town' } }],
        }));

        const first = await importAsBrowser(manager.jwt, zip);
        expect(first.status, await first.clone().text()).toBe(200);
        expect(await first.json()).toEqual({
            success: true,
            data: { inspections: 1, photos: 0, outbox: { applied: 1, skipped: 0, failed: [] }, yjs: { changed: 1, unchanged: 0 } },
        });
        expect(await addressOf(insp.id)).toBe('8 Web Import Way, Town');
        expect(await ratingOf(insp)).toBe('RR');

        const second = await importAsBrowser(manager.jwt, zip);
        expect(second.status, await second.clone().text()).toBe(200);
        expect(await second.json()).toEqual({
            success: true,
            data: { inspections: 1, photos: 0, outbox: { applied: 0, skipped: 1, failed: [] }, yjs: { changed: 0, unchanged: 1 } },
        });
    });

    it('refuses a package that names another company and writes nothing (positive control: the same package for this company)', async () => {
        const insp = await createInspection(owner);
        const mine = pkg(owner.id, insp, {
            outbox: [{ idempotencyKey: fresh('k'), op: 'inspection.update', payload: { id: insp.id, propertyAddress: '9 Foreign Lane, Town' } }],
        });
        const recordsBefore = await importRecords();
        const auditsBefore = await importAudits();

        // The tenant comes from the session; the manifest's claim is only checked against it.
        const refused = await importAsBrowser(manager.jwt, buildPackage({ ...mine, tenantId: OTHER_TENANT }));
        expect(refused.status).toBe(403);
        expect(await addressOf(insp.id)).toBe('1 Original Road, Anytown');
        expect(await ratingOf(insp)).toBeUndefined();
        expect(await importRecords()).toBe(recordsBefore);
        expect(await importAudits()).toBe(auditsBefore);

        const ok = await importAsBrowser(manager.jwt, buildPackage(mine));
        expect(ok.status, await ok.clone().text()).toBe(200);
        expect(await addressOf(insp.id)).toBe('9 Foreign Lane, Town');
        expect(await ratingOf(insp)).toBe('RR');
    });

    it('answers 401 with no session and writes nothing (positive control: the same package with a session)', async () => {
        const insp = await createInspection(owner);
        const zip = buildPackage(pkg(owner.id, insp));

        const anonymous = await importAsBrowser(null, zip);
        expect(anonymous.status).toBe(401);
        expect(await ratingOf(insp)).toBeUndefined();

        const garbage = await importAsBrowser('not-a-jwt', zip);
        expect(garbage.status).toBe(401);
        expect(await ratingOf(insp)).toBeUndefined();

        const ok = await importAsBrowser(manager.jwt, zip);
        expect(ok.status, await ok.clone().text()).toBe(200);
        expect(await ratingOf(insp)).toBe('RR');
    });

    it('refuses a manager whose report editing is switched off, without naming the inspection (positive control: a manager with it on)', async () => {
        const restricted = await addMember('manager', { editReports: false });
        const insp = await createInspection(owner);
        const zip = buildPackage(pkg(owner.id, insp));

        const refused = await importAsBrowser(restricted.jwt, zip);
        expect(refused.status).toBe(403);
        const error = await errorOf(refused);
        // A whole-package refusal: nothing in it points at one inspection, so a client cannot split around it.
        expect(error.details ?? {}).not.toHaveProperty('inspectionId');
        expect(error.details ?? {}).not.toHaveProperty('inspectionIds');
        expect(JSON.stringify(error)).not.toContain(insp.id);
        expect(await ratingOf(insp)).toBeUndefined();

        const ok = await importAsBrowser(manager.jwt, zip);
        expect(ok.status, await ok.clone().text()).toBe(200);
        expect(await ratingOf(insp)).toBe('RR');
    });

    it('refuses staff and agent sessions and writes nothing (positive control: an inspector)', async () => {
        const staff = await addMember('staff');
        const agent = await addMember('agent');
        const inspector = await addMember('inspector');
        const insp = await createInspection(inspector);
        const zip = buildPackage(pkg(inspector.id, insp));

        for (const denied of [staff, agent]) {
            const res = await importAsBrowser(denied.jwt, zip);
            expect(res.status, denied.role).toBe(403);
            expect((await errorOf(res)).details ?? {}).not.toHaveProperty('inspectionId');
            expect(await ratingOf(insp), denied.role).toBeUndefined();
        }

        const ok = await importAsBrowser(inspector.jwt, zip);
        expect(ok.status, await ok.clone().text()).toBe(200);
        expect(await ratingOf(insp)).toBe('RR');
    });

    it('is never held back by the minimum app version rule (positive and negative controls on the list)', () => {
        expect(isNeverBlocked('POST', '/api/client/import')).toBe(true);
        expect(isNeverBlocked('POST', '/api/client/imports')).toBe(false);
        expect(isNeverBlocked('POST', '/api/client/import/extra')).toBe(false);
    });
});
