/**
 * A person restricted to their assigned inspections, as the native client and the remote-tool bridge meet them.
 * Both reach the API through the real app and the real middleware chain, with identities that are NOT a browser
 * session: a native bearer grant, and a short-lived JWT minted from `internalJwtPayload` the way the MCP bridge
 * mints one. The scope is read from the users row on every request, so it is never baked into either credential.
 *
 * Every refusal is paired with a control that goes through: the same call for an inspection that is theirs, and
 * for an unrestricted caller, so a harness that refuses everything cannot pass.
 */
import { env as testEnv } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import * as Y from 'yjs';
import app from '../../../server/index';
import { buildKeyring, signJwt } from '../../../server/lib/jwt-keyring';
import { NATIVE_SCOPE, type NativeProps } from '../../../server/lib/auth/native-token';
import { internalJwtPayload } from '../../../server/lib/mcp/identity-bridge';
import { seedResultsDoc, applyItemPatch } from '@core/field-ui/shared/results-doc';
import { applyMigrations } from '../migration-replay';
import { buildPackage, type PackageSpec } from '../../unit/helpers/offline-package-fixture';

const migrationSql = import.meta.glob('../../../migrations/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

interface TestBindings { DB: D1Database }
const b = testEnv as unknown as TestBindings;

const TENANT = 'restricted-tenant';
const TEMPLATE = 'restricted-template';
const KEY = '_default:sec1:item1';

interface Member { id: string; token: string; role: 'owner' | 'manager' | 'inspector' }
const grants = new Map<string, NativeProps>();
let seq = 0;
const fresh = (prefix: string): string => `${prefix}-${++seq}-${crypto.randomUUID().slice(0, 6)}`;

const provider = {
    unwrapToken: async (t: string) => {
        const props = grants.get(t);
        return props ? { scope: [NATIVE_SCOPE], grant: { clientId: 'c', scope: [NATIVE_SCOPE], props } } : null;
    },
};

async function addMember(role: Member['role'], overrides: Record<string, boolean> | null = null): Promise<Member> {
    const id = fresh(`user-${role}`);
    await b.DB.prepare('INSERT INTO users (id, tenant_id, email, password_hash, name, role, permission_overrides, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, TENANT, `${id}@example.test`, 'x', id, role, overrides ? JSON.stringify(overrides) : null, Date.now()).run();
    const token = `u:g:${id}`;
    grants.set(token, { kind: 'native', userId: id, tenantId: TENANT, role, lastUsedAt: 0, grantedAt: 0 });
    return { id, token, role };
}

const setOverrides = (m: Member, overrides: Record<string, boolean> | null) =>
    b.DB.prepare('UPDATE users SET permission_overrides = ? WHERE id = ?').bind(overrides ? JSON.stringify(overrides) : null, m.id).run();

const pending: Promise<unknown>[] = [];
const ctx = {
    waitUntil: (p: Promise<unknown>) => { pending.push(p); },
    passThroughOnException: () => undefined,
} as unknown as ExecutionContext;

async function call(path: string, init: RequestInit & { token?: string } = {}): Promise<Response> {
    const { token, ...rest } = init;
    const headers = new Headers(rest.headers);
    if (token) headers.set('authorization', `Bearer ${token}`);
    const env = { ...testEnv, NATIVE_CLIENT_ENABLED: 'true', OAUTH_PROVIDER: provider };
    const res = await app.fetch(new Request(`http://x${path}`, { ...rest, headers }), env as never, ctx);
    await Promise.all(pending.splice(0));
    return res;
}

async function createInspection(by: Member): Promise<{ id: string; reportId: string }> {
    const id = fresh('insp');
    const res = await call('/api/inspections', {
        method: 'POST', token: by.token, headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, propertyAddress: `${id} Road`, templateId: TEMPLATE, date: '2026-10-01T10:00:00.000Z' }),
    });
    expect(res.status, await res.clone().text()).toBe(201);
    const row = await b.DB.prepare('SELECT id FROM reports WHERE inspection_id = ? AND tenant_id = ?').bind(id, TENANT).first<{ id: string }>();
    return { id, reportId: row!.id };
}

async function listedIds(token: string): Promise<string[]> {
    const res = await call('/api/inspections?limit=100', { token });
    expect(res.status, await res.clone().text()).toBe(200);
    const body = await res.json() as { data: Array<{ id: string }> };
    return body.data.map((i) => i.id).sort();
}

function packageFor(exportedBy: string, insp: { id: string; reportId: string }): Uint8Array {
    const doc = new Y.Doc();
    seedResultsDoc(doc, [{ findingKey: KEY }]);
    applyItemPatch(doc, KEY, 'rating', 'RR');
    const spec: PackageSpec = {
        tenantId: TENANT, exportedBy, inspections: [{ id: insp.id, reportId: insp.reportId }],
        yjs: { [insp.id]: Y.encodeStateAsUpdate(doc) },
    };
    return buildPackage(spec);
}

const importPackage = (token: string, zip: Uint8Array) =>
    call('/api/client/import', { method: 'POST', token, headers: { 'content-type': 'application/zip', 'content-length': String(zip.byteLength) }, body: new Uint8Array(zip) });

async function ratingStored(insp: { reportId: string }): Promise<boolean> {
    const rows = await b.DB.prepare('SELECT data FROM inspection_results WHERE report_id = ?').bind(insp.reportId).all<{ data: string }>();
    return rows.results.some((r) => r.data.includes('"RR"'));
}

describe('a restricted inspector over the native and MCP credentials', () => {
    let owner: Member;
    let restricted: Member;
    let peer: Member;
    let open: Member;
    let mine: { id: string; reportId: string };
    let theirs: { id: string; reportId: string };

    beforeAll(async () => {
        await applyMigrations(b.DB, migrationSql);
        await b.DB.exec('CREATE TABLE IF NOT EXISTS test_queue_log (id TEXT PRIMARY KEY, type TEXT, body TEXT, received_at INTEGER);');
        const now = Date.now();
        await b.DB.prepare('INSERT OR IGNORE INTO tenants (id, slug, created_at) VALUES (?, ?, ?)').bind(TENANT, 'restricted-tenant', now).run();
        await b.DB.prepare('INSERT OR IGNORE INTO templates (id, tenant_id, name, version, schema, created_at) VALUES (?, ?, ?, 1, ?, ?)')
            .bind(TEMPLATE, TENANT, 'Standard', JSON.stringify({ sections: [] }), now).run();
        owner = await addMember('owner');
        restricted = await addMember('inspector', { viewAllInspections: false });
        peer = await addMember('inspector', { viewAllInspections: false });
        open = await addMember('inspector');
        mine = await createInspection(restricted);
        theirs = await createInspection(peer);
        console.log('[gate] restricted native/MCP: inspections=2 members=4');
    });

    describe('native client bearer grant', () => {
        it('the inspection list is the assigned set; the unrestricted and owner views see both (control)', async () => {
            expect(await listedIds(restricted.token)).toEqual([mine.id]);
            expect(await listedIds(open.token)).toEqual([mine.id, theirs.id].sort());
            expect(await listedIds(owner.token)).toEqual([mine.id, theirs.id].sort());
        });
        it('opening an inspection outside the set answers 404, as a missing id does; one inside opens', async () => {
            expect((await call(`/api/inspections/${theirs.id}`, { token: restricted.token })).status).toBe(404);
            expect((await call('/api/inspections/does-not-exist', { token: restricted.token })).status).toBe(404);
            expect((await call(`/api/inspections/${mine.id}`, { token: restricted.token })).status).toBe(200);
        });
        it('the package import refuses a package that names an inspection outside the set, and writes nothing from it', async () => {
            const refused = await importPackage(restricted.token, packageFor(peer.id, theirs));
            expect(refused.status, await refused.clone().text()).toBe(404);
            expect(await ratingStored(theirs)).toBe(false);
        });
        it('a hidden id and an id that does not exist are refused with the same body, so the id probe learns nothing', async () => {
            const ghost = { id: fresh('insp-ghost'), reportId: 'report-ghost' };
            const hidden = await importPackage(restricted.token, packageFor(peer.id, theirs));
            const absent = await importPackage(restricted.token, packageFor(restricted.id, ghost));
            expect(hidden.status).toBe(404);
            expect(absent.status).toBe(404);
            const norm = async (r: Response, id: string) => JSON.stringify(await r.json()).split(id).join('<ID>');
            expect(await norm(hidden, theirs.id)).toBe(await norm(absent, ghost.id));
        });
        it('an unrestricted caller keeps the more specific answers (control)', async () => {
            const ghost = { id: fresh('insp-ghost'), reportId: 'report-ghost' };
            const absent = await importPackage(owner.token, packageFor(owner.id, ghost));
            expect(absent.status).toBe(404);
            expect(await absent.text()).toContain('does not exist and the package does not create it');
        });
        it('the package import accepts a package for an inspection inside the set (control)', async () => {
            const ok = await importPackage(restricted.token, packageFor(restricted.id, mine));
            expect(ok.status, await ok.clone().text()).toBe(200);
            expect(await ratingStored(mine)).toBe(true);
        });
        it('the scope is read fresh: lifting the restriction widens the very next request, restoring it narrows it', async () => {
            await setOverrides(restricted, null);
            expect(await listedIds(restricted.token)).toEqual([mine.id, theirs.id].sort());
            await setOverrides(restricted, { viewAllInspections: false });
            expect(await listedIds(restricted.token)).toEqual([mine.id]);
        });
    });

    describe('MCP bridge JWT', () => {
        async function bridgeToken(userId: string, role: 'inspector' | 'owner'): Promise<string> {
            const keyring = await buildKeyring(testEnv as never);
            return signJwt(internalJwtPayload({ userId, tenantId: TENANT, tenantSlug: TENANT, role, scopes: ['read:inspections'] }), keyring);
        }
        it('a token minted for the restricted user lists only their set; the owner token lists both (control)', async () => {
            expect(await listedIds(await bridgeToken(restricted.id, 'inspector'))).toEqual([mine.id]);
            expect(await listedIds(await bridgeToken(owner.id, 'owner'))).toEqual([mine.id, theirs.id].sort());
        });
        it('an inspection outside the set is a 404 through the bridge as well', async () => {
            const t = await bridgeToken(restricted.id, 'inspector');
            expect((await call(`/api/inspections/${theirs.id}`, { token: t })).status).toBe(404);
            expect((await call(`/api/inspections/${mine.id}`, { token: t })).status).toBe(200);
        });
        it('the restriction is not baked into the token: removing it widens the next call with the same token', async () => {
            const t = await bridgeToken(restricted.id, 'inspector');
            expect(await listedIds(t)).toEqual([mine.id]);
            await setOverrides(restricted, null);
            expect(await listedIds(t)).toEqual([mine.id, theirs.id].sort());
            await setOverrides(restricted, { viewAllInspections: false });
            expect(await listedIds(t)).toEqual([mine.id]);
        });
    });

    // Last on purpose: the fresh inspection it creates would otherwise appear in the lists the earlier cases compare.
    it('a create op that names the id of a hidden inspection is refused and writes nothing; a fresh id in the same shape is created (the id-exists property, accepted)', async () => {
        const createPackage = (id: string) => buildPackage({
            tenantId: TENANT, exportedBy: restricted.id, inspections: [{ id, reportId: 'device-report' }],
            yjs: { [id]: Y.encodeStateAsUpdate((() => { const d = new Y.Doc(); seedResultsDoc(d, [{ findingKey: KEY }]); return d; })()) },
            outbox: [{ idempotencyKey: fresh('k'), op: 'inspection.create', payload: { id, propertyAddress: '9 Probe Road, Town', templateId: TEMPLATE } }],
        });
        const before = await b.DB.prepare('SELECT property_address AS a, inspector_id AS i FROM inspections WHERE id = ?').bind(theirs.id).first<{ a: string; i: string | null }>();
        const refused = await importPackage(restricted.token, createPackage(theirs.id));
        
        expect(refused.status).toBe(404);
        // nothing about the hidden inspection changed, and its details are not in the answer
        expect(await b.DB.prepare('SELECT property_address AS a, inspector_id AS i FROM inspections WHERE id = ?').bind(theirs.id).first()).toEqual(before);
        expect(await refused.text()).not.toContain(before!.a);
        // control: the same shape with an id nobody holds creates the inspection
        const freshId = fresh('insp-probe');
        const created = await importPackage(restricted.token, createPackage(freshId));
        expect(created.status, await created.clone().text()).toBe(200);
        expect(await b.DB.prepare('SELECT COUNT(*) AS n FROM inspections WHERE id = ?').bind(freshId).first<{ n: number }>()).toEqual({ n: 1 });
    });
});
