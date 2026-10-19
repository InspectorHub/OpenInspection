/**
 * POST /api/client/inspections/visible against a real D1 and the real middleware chain.
 *
 * The device sends the inspection ids it holds; the server answers which of them still exist in the
 * caller's company and are visible to the caller. The properties that matter, each paired with a control
 * that goes through so a harness that refuses everything cannot pass:
 *  - another company's id never appears, and answers like an id that does not exist;
 *  - for a restricted caller, "exists but is not mine" and "does not exist" are byte-identical;
 *  - a failure is an error status with no `visible` field, never 200 with an empty list;
 *  - the request is bounded, and the D1 round-trips are bounded with it.
 */
import { env as testEnv } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import app from '../../../server/index';
import { buildKeyring, signJwt } from '../../../server/lib/jwt-keyring';
import { NATIVE_SCOPE, type NativeProps } from '../../../server/lib/auth/native-token';
import { applyMigrations } from '../migration-replay';

const migrationSql = import.meta.glob('../../../migrations/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

interface TestBindings { DB: D1Database }
const b = testEnv as unknown as TestBindings;

const TENANT = 'visible-tenant';
const OTHER = 'visible-other-tenant';
const TEMPLATE = 'visible-template';
const URL_PATH = '/api/client/inspections/visible';

interface Member { id: string; token: string; tenant: string }
const grants = new Map<string, NativeProps>();
let seq = 0;
const fresh = (prefix: string): string => `${prefix}-${++seq}-${crypto.randomUUID().slice(0, 6)}`;

const provider = {
    unwrapToken: async (t: string) => {
        const props = grants.get(t);
        return props ? { scope: [NATIVE_SCOPE], grant: { clientId: 'c', scope: [NATIVE_SCOPE], props } } : null;
    },
};

async function addMember(tenant: string, role: 'owner' | 'inspector', overrides: Record<string, boolean> | null = null): Promise<Member> {
    const id = fresh(`user-${role}`);
    await b.DB.prepare('INSERT INTO users (id, tenant_id, email, password_hash, name, role, permission_overrides, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, tenant, `${id}@example.test`, 'x', id, role, overrides ? JSON.stringify(overrides) : null, Date.now()).run();
    const token = `u:g:${id}`;
    grants.set(token, { kind: 'native', userId: id, tenantId: tenant, role, lastUsedAt: 0, grantedAt: 0 });
    return { id, token, tenant };
}

const pending: Promise<unknown>[] = [];
const ctx = { waitUntil: (p: Promise<unknown>) => { pending.push(p); }, passThroughOnException: () => undefined } as unknown as ExecutionContext;

async function call(path: string, init: RequestInit & { token?: string; env?: Record<string, unknown> } = {}): Promise<Response> {
    const { token, env: extra, ...rest } = init;
    const headers = new Headers(rest.headers);
    if (token) headers.set('authorization', `Bearer ${token}`);
    const env = { ...testEnv, NATIVE_CLIENT_ENABLED: 'true', OAUTH_PROVIDER: provider, ...extra };
    const res = await app.fetch(new Request(`http://x${path}`, { ...rest, headers }), env as never, ctx);
    await Promise.all(pending.splice(0));
    return res;
}

const visible = (token: string | undefined, ids: unknown, env?: Record<string, unknown>): Promise<Response> =>
    call(URL_PATH, { method: 'POST', token, env, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids }) });

async function visibleIds(token: string, ids: string[]): Promise<string[]> {
    const res = await visible(token, ids);
    expect(res.status, await res.clone().text()).toBe(200);
    return ((await res.json()) as { success: true; data: { visible: string[] } }).data.visible;
}

async function createInspection(by: Member): Promise<string> {
    const id = fresh('insp');
    const res = await call('/api/inspections', {
        method: 'POST', token: by.token, headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, propertyAddress: `${id} Road`, templateId: `${TEMPLATE}-${by.tenant}`, date: '2026-10-01T10:00:00.000Z' }),
    });
    expect(res.status, await res.clone().text()).toBe(201);
    return id;
}

// --- Counting D1 round-trips and bind parameters ---------------------------------------------

interface D1Counter { calls: number; maxBinds: number }

/** The environment with DB wrapped so every statement execution and batch counts as one round-trip. */
function countingEnv(counter: D1Counter): Record<string, unknown> {
    const OPS = new Set(['run', 'all', 'first', 'raw']);
    const originals = new WeakMap<object, object>();
    const wrapStatement = (stmt: object): object => {
        const proxy = new Proxy(stmt, {
            get(obj, prop) {
                const value = Reflect.get(obj, prop, obj);
                if (typeof value !== 'function') return value;
                return (...args: unknown[]) => {
                    if (prop === 'bind') {
                        counter.maxBinds = Math.max(counter.maxBinds, args.length);
                        return wrapStatement(Reflect.apply(value, obj, args) as object);
                    }
                    if (OPS.has(String(prop))) counter.calls++;
                    return Reflect.apply(value, obj, args);
                };
            },
        });
        originals.set(proxy, stmt);
        return proxy;
    };
    const db = new Proxy(b.DB, {
        get(obj, prop) {
            const value = Reflect.get(obj, prop, obj);
            if (typeof value !== 'function') return value;
            return (...args: unknown[]) => {
                if (prop === 'batch' || prop === 'exec') counter.calls++;
                if (prop === 'batch' && Array.isArray(args[0])) {
                    return Reflect.apply(value, obj, [args[0].map((s: unknown) => (typeof s === 'object' && s !== null ? originals.get(s) ?? s : s))]);
                }
                const result = Reflect.apply(value, obj, args);
                return prop === 'prepare' ? wrapStatement(result as object) : result;
            };
        },
    });
    return { DB: db };
}

describe('POST /api/client/inspections/visible', () => {
    let owner: Member;
    let restricted: Member;
    let peer: Member;
    let outsider: Member;
    let mine: string;
    let theirs: string;
    let gone: string;
    let ownerOwn: string;
    let foreign: string;

    beforeAll(async () => {
        await applyMigrations(b.DB, migrationSql);
        await b.DB.exec('CREATE TABLE IF NOT EXISTS test_queue_log (id TEXT PRIMARY KEY, type TEXT, body TEXT, received_at INTEGER);');
        const now = Date.now();
        for (const t of [TENANT, OTHER]) {
            await b.DB.prepare('INSERT OR IGNORE INTO tenants (id, slug, created_at) VALUES (?, ?, ?)').bind(t, t, now).run();
            await b.DB.prepare('INSERT OR IGNORE INTO templates (id, tenant_id, name, version, schema, created_at) VALUES (?, ?, ?, 1, ?, ?)')
                .bind(`${TEMPLATE}-${t}`, t, 'Standard', JSON.stringify({ sections: [] }), now).run();
        }
        owner = await addMember(TENANT, 'owner');
        restricted = await addMember(TENANT, 'inspector', { viewAllInspections: false });
        peer = await addMember(TENANT, 'inspector', { viewAllInspections: false });
        outsider = await addMember(OTHER, 'owner');
        mine = await createInspection(restricted);
        theirs = await createInspection(peer);
        ownerOwn = await createInspection(owner);
        gone = await createInspection(owner);
        const del = await call(`/api/inspections/${gone}`, { method: 'DELETE', token: owner.token });
        expect(del.status, await del.clone().text()).toBe(200);
        foreign = await createInspection(outsider);
    });

    it('returns the ids that exist, in request order and without repeats (owner); a deleted id is left out', async () => {
        expect(await visibleIds(owner.token, [theirs, gone, mine, ownerOwn, mine])).toEqual([theirs, mine, ownerOwn]);
    });

    it("never returns another company's inspection, and answers it exactly as an id that does not exist", async () => {
        const withForeign = await visible(owner.token, [mine, foreign]);
        const withGhost = await visible(owner.token, [mine, fresh('insp-ghost')]);
        expect(withForeign.status).toBe(200);
        expect(await withForeign.text()).toBe(await withGhost.text());
        // Control: the same id is visible to the company that owns it.
        expect(await visibleIds(outsider.token, [foreign, mine])).toEqual([foreign]);
    });

    it('limits a restricted caller to the assigned set (controls: the owner and the peer see theirs)', async () => {
        expect(await visibleIds(restricted.token, [theirs, mine, ownerOwn, gone])).toEqual([mine]);
        expect(await visibleIds(peer.token, [theirs, mine])).toEqual([theirs]);
        expect(await visibleIds(owner.token, [theirs, mine])).toEqual([theirs, mine]);
    });

    it('answers "exists but is not mine" and "does not exist" with byte-identical responses to a restricted caller', async () => {
        const hidden = await visible(restricted.token, [theirs]);
        const absent = await visible(restricted.token, [fresh('insp-ghost')]);
        expect(hidden.status).toBe(200);
        expect(absent.status).toBe(200);
        expect(await hidden.text()).toBe(await absent.text());
        const mixedHidden = await visible(restricted.token, [mine, theirs, ownerOwn]);
        const mixedAbsent = await visible(restricted.token, [mine, fresh('g1'), fresh('g2')]);
        expect(await mixedHidden.text()).toBe(await mixedAbsent.text());
        // Control: the responses are not all the same, a visible id does show up.
        expect(await visibleIds(restricted.token, [mine])).toEqual([mine]);
    });

    it('fails with an error status and no `visible` field when D1 fails (control: the same request succeeds without the fault)', async () => {
        const faulty = {
            DB: new Proxy(b.DB, {
                get(obj, prop) {
                    const value = Reflect.get(obj, prop, obj);
                    if (prop !== 'prepare') return typeof value === 'function' ? value.bind(obj) : value;
                    return (sql: string) => {
                        if (/from "inspections"/i.test(sql) && / in \(/i.test(sql)) throw new Error('simulated D1 outage');
                        return obj.prepare(sql);
                    };
                },
            }),
        };
        const failed = await visible(owner.token, [mine], faulty);
        const text = await failed.text();
        expect(failed.status, text).toBeGreaterThanOrEqual(500);
        expect(text).not.toContain('"visible"');
        const ok = await visible(owner.token, [mine]);
        expect(ok.status).toBe(200);
    });

    it('refuses an over-long, empty or malformed list with 422 (controls: a list at the limit, and a legal id shape, pass)', async () => {
        const over = await visible(owner.token, Array.from({ length: 301 }, (_, i) => `x${i}`));
        expect(over.status).toBe(422);
        const body = await over.json() as { success: false; error: { details?: { limits?: { ids?: number } } } };
        expect(body.error.details?.limits?.ids).toBe(300);
        expect(JSON.stringify(body)).not.toContain('"visible"');
        expect((await visible(owner.token, [])).status).toBe(422);
        expect((await visible(owner.token, ['has space'])).status).toBe(422);
        expect((await visible(owner.token, ['a'.repeat(65)])).status).toBe(422);
        expect((await visible(owner.token, [mine, 7])).status).toBeGreaterThanOrEqual(400);
        const noIds = await call(URL_PATH, { method: 'POST', token: owner.token, headers: { 'content-type': 'application/json' }, body: '{}' });
        expect(noIds.status).toBeGreaterThanOrEqual(400);
        expect((await visible(owner.token, Array.from({ length: 300 }, (_, i) => `x${i}`))).status).toBe(200);
        expect((await visible(owner.token, ['Abc_-123'])).status).toBe(200);
    });

    it('takes the limit from NATIVE_VISIBLE_MAX_IDS', async () => {
        const env = { NATIVE_VISIBLE_MAX_IDS: '2' };
        expect((await visible(owner.token, [mine, theirs, ownerOwn], env)).status).toBe(422);
        expect((await visible(owner.token, [mine, theirs], env)).status).toBe(200);
    });

    it('is a native-session route: a browser session JWT gets 401 (control: the native token gets 200)', async () => {
        const keyring = await buildKeyring(testEnv as never);
        const now = Math.floor(Date.now() / 1000); // seed-lint-ok: JWT iat/exp claims are seconds; not a database column
        const jwt = await signJwt({
            sub: owner.id, role: 'owner', 'custom:userRole': 'owner', 'custom:tenantId': TENANT, iat: now, exp: now + 3600,
        }, keyring);
        expect((await call('/api/inspections', { token: jwt })).status).toBe(200);
        expect((await visible(jwt, [mine])).status).toBe(401);
        const cookie = await call(URL_PATH, {
            method: 'POST', headers: { 'content-type': 'application/json', cookie: `__Host-inspector_token=${jwt}` }, body: JSON.stringify({ ids: [mine] }),
        });
        expect(cookie.status).toBe(401);
        expect((await visible(undefined, [mine])).status).toBe(401);
        expect((await visible(owner.token, [mine])).status).toBe(200);
    });

    it('is off with the rest of the native surface when NATIVE_CLIENT_ENABLED is not set (control: on, it answers)', async () => {
        const off = await visible(owner.token, [mine], { NATIVE_CLIENT_ENABLED: undefined });
        expect(off.status).toBe(401);
        expect(await off.text()).not.toContain('"visible"');
        expect((await visible(owner.token, [mine])).status).toBe(200);
    });

    it('takes the tenant from the session only: a tenant named in the body changes nothing', async () => {
        const res = await call(URL_PATH, {
            method: 'POST', token: owner.token, headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ids: [mine, foreign], tenantId: OTHER }),
        });
        expect(res.status, await res.clone().text()).toBe(200);
        expect(((await res.json()) as { data: { visible: string[] } }).data.visible).toEqual([mine]);
    });

    it('uses a bounded number of D1 round-trips and bind parameters: 300 ids cost 3 more than 1 id, and no statement binds over 90', async () => {
        const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => (i === 0 ? mine : `ghost-${i}`));
        const measure = async (token: string, n: number): Promise<D1Counter> => {
            const counter: D1Counter = { calls: 0, maxBinds: 0 };
            const res = await visible(token, ids(n), countingEnv(counter));
            expect(res.status, await res.clone().text()).toBe(200);
            return counter;
        };
        for (const [label, who] of [['unrestricted', owner], ['restricted', restricted]] as const) {
            await measure(who.token, 1); // warm caches so the comparison is of steady state
            const one = await measure(who.token, 1);
            const many = await measure(who.token, 300);
            console.info(`[budget] visible ${label}: 1 id = ${one.calls} D1 calls, 300 ids = ${many.calls} D1 calls, max binds ${many.maxBinds}`);
            expect(one.calls, 'the counter must see the request').toBeGreaterThan(0);
            expect(many.calls - one.calls, `${label}: ceil(300/80) = 4 chunks, 1 already counted`).toBe(3);
            expect(many.maxBinds).toBeLessThanOrEqual(90);
        }
    });
});
