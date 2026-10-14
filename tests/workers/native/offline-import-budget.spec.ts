/**
 * The import limits, in workerd: the subrequest budget the defaults are sized
 * for, the refusal when a package is over a limit, and the environment overrides.
 *
 * Subrequests are counted by wrapping every binding the import touches (D1, KV,
 * R2, the queue and the Durable Objects) in a Proxy that counts the calls which
 * cross the binding boundary: one per D1 statement execution or batch, one per KV
 * or R2 operation, one per queue send, one per Durable Object fetch. That is the
 * unit the Workers Free plan caps at 1000 per invocation. Miniflare does not
 * enforce the cap or the CPU limit, so the wall-clock time printed here is a
 * reference for relative cost only, not evidence about CPU time on Cloudflare.
 *
 * Every refusal is paired with a positive control (a package exactly at the
 * limit imports) so a harness that refuses everything cannot pass.
 */
import { env as testEnv } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import * as Y from 'yjs';
import app from '../../../server/index';
import { NATIVE_SCOPE, type NativeProps } from '../../../server/lib/auth/native-token';
import { seedResultsDoc, pushPendingPhoto } from '../../../server/lib/collab/results-doc';
import type { PhotoEntry } from '../../../server/lib/collab/results-doc.types';
import { DEFAULT_IMPORT_LIMITS, estimateSubrequests } from '../../../server/lib/native/import-limits';
import { applyMigrations } from '../migration-replay';
import { buildPackage, type PackageOutboxEntry, type PackageSpec } from '../../unit/helpers/offline-package-fixture';

const migrationSql = import.meta.glob('../../../migrations/*.sql', {
    query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

const TENANT = 'budget-tenant';
const TEMPLATE = 'budget-template';
const KEY = '_default:sec1:item1';
const FREE_SUBREQUEST_CEILING = 1000;

let seq = 0;
const fresh = (prefix: string): string => `${prefix}-${++seq}-${crypto.randomUUID().slice(0, 6)}`;

// ─── Counting the binding calls ──────────────────────────────────────────────

class Counter {
    readonly by = new Map<string, number>();
    hit(label: string): void { this.by.set(label, (this.by.get(label) ?? 0) + 1); }
    get total(): number { let n = 0; for (const v of this.by.values()) n += v; return n; }
    describe(): string { return [...this.by].map(([k, v]) => `${k}=${v}`).join(' '); }
}

const originals = new WeakMap<object, object>();

/** Wraps `target`; calls to the named operations are counted, and `derive` may wrap what a method returns. */
function watch<T extends object>(
    counter: Counter, label: string, target: T, ops: ReadonlySet<string>,
    derive?: (method: string, result: unknown) => unknown,
): T {
    const proxy = new Proxy(target, {
        get(obj, prop) {
            const value = Reflect.get(obj, prop, obj);
            if (typeof value !== 'function') return value;
            return (...args: unknown[]) => {
                const method = String(prop);
                if (ops.has(method)) counter.hit(label);
                const first = args[0];
                const forwarded = method === 'batch' && Array.isArray(first)
                    ? [first.map((s: unknown) => (typeof s === 'object' && s !== null ? originals.get(s) ?? s : s))]
                    : args;
                const result: unknown = Reflect.apply(value, obj, forwarded);
                return derive ? derive(method, result) : result;
            };
        },
    });
    originals.set(proxy, target);
    return proxy;
}

const D1_STATEMENT_OPS = new Set(['run', 'all', 'first', 'raw']);
const D1_OPS = new Set(['batch', 'exec']);
const KV_OPS = new Set(['get', 'getWithMetadata', 'put', 'delete', 'list']);
const R2_OPS = new Set(['get', 'head', 'put', 'delete', 'list', 'createMultipartUpload', 'resumeMultipartUpload']);
const QUEUE_OPS = new Set(['send', 'sendBatch']);
const STUB_OPS = new Set(['fetch']);

function watchStatement(counter: Counter, statement: object): object {
    return watch(counter, 'D1', statement, D1_STATEMENT_OPS, (method, result) =>
        method === 'bind' && typeof result === 'object' && result !== null ? watchStatement(counter, result) : result);
}

/** The environment with every binding the import crosses replaced by a counting wrapper. */
function instrumented(counter: Counter): Record<string, unknown> {
    const get = (key: string): object => {
        const value: unknown = Reflect.get(testEnv, key);
        if (typeof value !== 'object' || value === null) throw new Error(`test environment has no ${key} binding`);
        return value;
    };
    const namespace = (key: string) => watch(counter, 'DO', get(key), new Set(), (method, result) =>
        method === 'get' && typeof result === 'object' && result !== null ? watch(counter, 'DO', result, STUB_OPS) : result);
    return {
        DB: watch(counter, 'D1', get('DB'), D1_OPS, (method, result) =>
            method === 'prepare' && typeof result === 'object' && result !== null ? watchStatement(counter, result) : result),
        TENANT_CACHE: watch(counter, 'KV', get('TENANT_CACHE'), KV_OPS),
        OAUTH_KV: watch(counter, 'KV', get('OAUTH_KV'), KV_OPS),
        PHOTOS: watch(counter, 'R2', get('PHOTOS'), R2_OPS),
        SYNC_QUEUE: watch(counter, 'Queue', get('SYNC_QUEUE'), QUEUE_OPS),
        INSPECTION_DOC: namespace('INSPECTION_DOC'),
        INSPECTION_PRESENCE: namespace('INSPECTION_PRESENCE'),
    };
}

// ─── Calling the real app ────────────────────────────────────────────────────

interface Member { id: string; token: string }
const grants = new Map<string, NativeProps>();
const provider = {
    unwrapToken: async (t: string) => {
        const props = grants.get(t);
        return props ? { scope: [NATIVE_SCOPE], grant: { clientId: 'c', scope: [NATIVE_SCOPE], props } } : null;
    },
};
const pending: Promise<unknown>[] = [];
const ctx = {
    waitUntil: (p: Promise<unknown>) => { pending.push(p); },
    passThroughOnException: () => undefined,
} as unknown as ExecutionContext;

async function importPackage(token: string, zip: Uint8Array, opts: { env?: Record<string, unknown>; contentLength?: string } = {}): Promise<Response> {
    const headers = new Headers({
        'content-type': 'application/zip', 'content-length': opts.contentLength ?? String(zip.byteLength), authorization: `Bearer ${token}`,
    });
    const env = { ...testEnv, NATIVE_CLIENT_ENABLED: 'true', OAUTH_PROVIDER: provider, ...opts.env };
    const res = await app.fetch(new Request('http://x/api/client/import', { method: 'POST', headers, body: new Uint8Array(zip) }), env as never, ctx);
    await Promise.all(pending.splice(0));
    return res;
}

interface Measured { res: Response; subrequests: number; breakdown: string; ms: number }

async function measuredImport(token: string, zip: Uint8Array): Promise<Measured> {
    const counter = new Counter();
    const started = performance.now();
    const res = await importPackage(token, zip, { env: instrumented(counter) });
    return { res, subrequests: counter.total, breakdown: counter.describe(), ms: performance.now() - started };
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const q = async (sql: string, ...binds: unknown[]): Promise<number> =>
    (await testEnv.DB.prepare(sql).bind(...binds).first<{ n: number }>())?.n ?? 0;

const inspectionCount = (): Promise<number> => q('SELECT count(*) AS n FROM inspections WHERE tenant_id = ?', TENANT);
const ledgerCount = (): Promise<number> => q('SELECT count(*) AS n FROM offline_import_applied WHERE tenant_id = ?', TENANT);
const auditCount = (): Promise<number> => q("SELECT count(*) AS n FROM audit_logs WHERE tenant_id = ? AND action = 'native.offline_import'", TENANT);
const photoCount = async (): Promise<number> => (await testEnv.PHOTOS.list({ prefix: `${TENANT}/` })).objects.length;

interface Shape { inspections: number; writes: number; photos: number }

/** A package that creates `inspections` inspections, queues `writes` writes in all, and carries `photos` pending photos. */
function shapedPackage(shape: Shape, exportedBy: string): { zip: Uint8Array; ids: string[] } {
    const ids = Array.from({ length: shape.inspections }, () => fresh('insp'));
    const outbox: PackageOutboxEntry[] = ids.map((id) => ({
        idempotencyKey: fresh('k'), op: 'inspection.create',
        payload: { id, propertyAddress: '1 Budget Road', templateId: TEMPLATE, date: '2026-10-02T10:00:00.000Z' },
    }));
    for (let i = ids.length; i < shape.writes; i++) {
        outbox.push({ idempotencyKey: fresh('k'), op: 'inspection.update', payload: { id: ids[i % ids.length]!, propertyAddress: `${i} Changed Avenue` } });
    }
    const docs = ids.map(() => new Y.Doc());
    docs.forEach((doc) => seedResultsDoc(doc, [{ findingKey: KEY }]));
    const media: NonNullable<PackageSpec['media']> = [];
    for (let i = 0; i < shape.photos; i++) {
        const at = i % ids.length;
        const pendingId = `ph-${i}-${seq}`;
        const photo: PhotoEntry & { pendingId: string } = { key: '', pendingUpload: true, pendingId, pendingKind: 'photo', mediaId: `m-${pendingId}` };
        pushPendingPhoto(docs[at]!, KEY, photo);
        media.push({ pendingId, inspectionId: ids[at]!, contentType: 'image/jpeg' });
    }
    const yjs = Object.fromEntries(ids.map((id, i) => [id, Y.encodeStateAsUpdate(docs[i]!)]));
    return {
        ids,
        zip: buildPackage({
            tenantId: TENANT, exportedBy, inspections: ids.map((id) => ({ id, reportId: 'device-report' })), yjs, outbox, media,
        }),
    };
}

interface ErrorBody { success: false; error: { code: string; details?: { limit: string; max: number; actual: number; limits: Record<string, number> } } }

describe('offline import limits', () => {
    let manager: Member;

    beforeAll(async () => {
        await applyMigrations(testEnv.DB, migrationSql);
        await testEnv.DB.exec('CREATE TABLE IF NOT EXISTS test_queue_log (id TEXT PRIMARY KEY, type TEXT, body TEXT, received_at INTEGER);');
        const now = Date.now();
        await testEnv.DB.prepare('INSERT OR IGNORE INTO tenants (id, slug, created_at) VALUES (?, ?, ?)').bind(TENANT, TENANT, now).run();
        await testEnv.DB.prepare('INSERT OR IGNORE INTO templates (id, tenant_id, name, version, schema, created_at) VALUES (?, ?, ?, 1, ?, ?)')
            .bind(TEMPLATE, TENANT, 'Standard', JSON.stringify({ sections: [] }), now).run();
        const id = fresh('user-manager');
        await testEnv.DB.prepare('INSERT INTO users (id, tenant_id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .bind(id, TENANT, `${id}@example.test`, 'x', id, 'manager', now).run();
        const token = `u:g:${id}`;
        grants.set(token, { kind: 'native', userId: id, tenantId: TENANT, role: 'manager', lastUsedAt: 0, grantedAt: 0 });
        manager = { id, token };
    });

    // ── the subrequest budget ─────────────────────────────────────────────────
    // The largest package runs first, on a cold start, because caches that later imports
    // find warm are exactly what a real first import after a deploy does not have.

    it('imports the largest package the default limits admit within the Free plan subrequest ceiling', async () => {
        const shape = { inspections: DEFAULT_IMPORT_LIMITS.inspections, writes: DEFAULT_IMPORT_LIMITS.outbox, photos: DEFAULT_IMPORT_LIMITS.photos };
        const { zip, ids } = shapedPackage(shape, manager.id);
        const before = { insp: await inspectionCount(), photos: await photoCount() };
        const m = await measuredImport(manager.token, zip);
        expect(m.res.status, await m.res.clone().text()).toBe(200);
        expect(await inspectionCount()).toBe(before.insp + ids.length);
        expect(await photoCount()).toBe(before.photos + shape.photos);
        console.info(`[budget] default maximum ${JSON.stringify(shape)}: ${m.subrequests} subrequests (${m.breakdown}), estimate ${estimateSubrequests({ inspections: shape.inspections, outbox: shape.writes, photos: shape.photos })}, ${m.ms.toFixed(0)} ms wall in miniflare (no CPU limit enforced)`);
        expect(m.subrequests).toBeLessThan(FREE_SUBREQUEST_CEILING);
        const estimate = estimateSubrequests({ inspections: shape.inspections, outbox: shape.writes, photos: shape.photos });
        expect(m.subrequests, 'the documented estimate must not understate the measurement').toBeLessThanOrEqual(estimate);
        expect(m.subrequests, 'the defaults are meant to leave about a fifth of the ceiling free').toBeLessThan(800);
    });

    it('imports a typical package (3 inspections, 20 writes, 50 photos) in a modest share of the subrequest ceiling', async () => {
        const shape = { inspections: 3, writes: 20, photos: 50 };
        const { zip, ids } = shapedPackage(shape, manager.id);
        const before = { insp: await inspectionCount(), photos: await photoCount() };
        const m = await measuredImport(manager.token, zip);
        expect(m.res.status, await m.res.clone().text()).toBe(200);
        expect(await inspectionCount()).toBe(before.insp + ids.length);
        expect(await photoCount()).toBe(before.photos + shape.photos);
        console.info(`[budget] typical ${JSON.stringify(shape)}: ${m.subrequests} subrequests (${m.breakdown}), estimate ${estimateSubrequests({ inspections: shape.inspections, outbox: shape.writes, photos: shape.photos })}, ${m.ms.toFixed(0)} ms wall in miniflare (no CPU limit enforced)`);
        expect(m.subrequests).toBeLessThan(700);
    });

    it('counts a repeat of the same package too (every step is idempotent, so the repeat still has to fit)', async () => {
        const shape = { inspections: 5, writes: 12, photos: 20 };
        const { zip } = shapedPackage(shape, manager.id);
        expect((await measuredImport(manager.token, zip)).res.status).toBe(200);
        const again = await measuredImport(manager.token, zip);
        expect(again.res.status, await again.res.clone().text()).toBe(200);
        console.info(`[budget] repeat of ${JSON.stringify(shape)}: ${again.subrequests} subrequests (${again.breakdown})`);
        expect(again.subrequests).toBeLessThan(FREE_SUBREQUEST_CEILING);
    });

    it('counts nothing when the wrapper is not in the path (control: the counter only sees what it wraps)', async () => {
        const counter = new Counter();
        const { zip } = shapedPackage({ inspections: 1, writes: 1, photos: 1 }, manager.id);
        expect((await importPackage(manager.token, zip)).status).toBe(200);
        expect(counter.total).toBe(0);
        const wrapped = await measuredImport(manager.token, shapedPackage({ inspections: 1, writes: 1, photos: 1 }, manager.id).zip);
        expect(wrapped.subrequests).toBeGreaterThan(0);
    });

    // ── refusals write nothing ────────────────────────────────────────────────

    const refusedWithoutWriting = async (shape: Shape, limit: string, max: number, env?: Record<string, unknown>) => {
        const { zip } = shapedPackage(shape, manager.id);
        const before = [await inspectionCount(), await photoCount(), await ledgerCount(), await auditCount()];
        const res = await importPackage(manager.token, zip, env ? { env } : {});
        expect(res.status, await res.clone().text()).toBe(422);
        const body = (await res.json()) as ErrorBody;
        expect(body.error.code).toBe('PACKAGE_TOO_LARGE');
        expect(body.error.details).toMatchObject({ limit, max, actual: max + 1 });
        expect(body.error.details?.limits).toMatchObject({ inspections: expect.any(Number), outbox: expect.any(Number), photos: expect.any(Number), compressedBytes: expect.any(Number) });
        expect([await inspectionCount(), await photoCount(), await ledgerCount(), await auditCount()], 'a refused package must change nothing').toEqual(before);
    };

    it('refuses one write over the limit with 422 and writes nothing (positive control: exactly the limit imports)', async () => {
        const at = { inspections: 2, writes: DEFAULT_IMPORT_LIMITS.outbox, photos: 2 };
        await refusedWithoutWriting({ ...at, writes: at.writes + 1 }, 'outbox', DEFAULT_IMPORT_LIMITS.outbox);
        const ok = await importPackage(manager.token, shapedPackage(at, manager.id).zip);
        expect(ok.status, await ok.clone().text()).toBe(200);
    });

    it('refuses one photo over the limit with 422 and writes nothing (positive control: exactly the limit imports)', async () => {
        const at = { inspections: 2, writes: 2, photos: DEFAULT_IMPORT_LIMITS.photos };
        await refusedWithoutWriting({ ...at, photos: at.photos + 1 }, 'photos', DEFAULT_IMPORT_LIMITS.photos);
        const ok = await importPackage(manager.token, shapedPackage(at, manager.id).zip);
        expect(ok.status, await ok.clone().text()).toBe(200);
    });

    it('refuses one inspection over the limit with 422 and writes nothing (positive control: exactly the limit imports)', async () => {
        const at = { inspections: DEFAULT_IMPORT_LIMITS.inspections, writes: DEFAULT_IMPORT_LIMITS.inspections, photos: 0 };
        await refusedWithoutWriting({ ...at, inspections: at.inspections + 1, writes: at.writes + 1 }, 'inspections', DEFAULT_IMPORT_LIMITS.inspections);
        const ok = await importPackage(manager.token, shapedPackage(at, manager.id).zip);
        expect(ok.status, await ok.clone().text()).toBe(200);
    });

    it('refuses more archive entries than the limit with 422 (positive control: at the limit)', async () => {
        const env = { NATIVE_IMPORT_MAX_ENTRIES: '10' };
        // manifest + outbox + media index + 1 Yjs state + 6 photos = 10 entries.
        const at = { inspections: 1, writes: 1, photos: 6 };
        const { zip: over } = shapedPackage({ ...at, photos: 7 }, manager.id);
        const before = [await inspectionCount(), await photoCount(), await ledgerCount()];
        const res = await importPackage(manager.token, over, { env });
        expect(res.status).toBe(422);
        expect(((await res.json()) as ErrorBody).error.details).toMatchObject({ limit: 'entries', max: 10, actual: 11 });
        expect([await inspectionCount(), await photoCount(), await ledgerCount()]).toEqual(before);
        const ok = await importPackage(manager.token, shapedPackage(at, manager.id).zip, { env });
        expect(ok.status, await ok.clone().text()).toBe(200);
    });

    it('answers 413 PACKAGE_TOO_LARGE with the limits for a declared body over the byte limit, and for an unpacked size over its limit', async () => {
        const { zip } = shapedPackage({ inspections: 1, writes: 1, photos: 1 }, manager.id);
        const declared = await importPackage(manager.token, zip, { contentLength: String(DEFAULT_IMPORT_LIMITS.compressedBytes + 1) });
        expect(declared.status).toBe(413);
        const body = (await declared.json()) as ErrorBody;
        expect(body.error.code).toBe('PACKAGE_TOO_LARGE');
        expect(body.error.details).toMatchObject({ limit: 'compressedBytes', max: DEFAULT_IMPORT_LIMITS.compressedBytes, limits: { inspections: 8, outbox: 20, photos: 50 } });

        const big = buildPackage({
            tenantId: TENANT, exportedBy: manager.id, inspections: [{ id: 'unpack-1', reportId: 'r' }],
            media: [{ pendingId: 'big-1', inspectionId: 'unpack-1', contentType: 'image/jpeg', bytes: new Uint8Array(200 * 1024) }],
        });
        const env = { NATIVE_IMPORT_MAX_UNCOMPRESSED_BYTES: String(64 * 1024) };
        const unpacked = await importPackage(manager.token, big, { env });
        expect(unpacked.status).toBe(413);
        expect(((await unpacked.json()) as ErrorBody).error.details).toMatchObject({ limit: 'uncompressedBytes', max: 64 * 1024 });
    });

    it('puts nothing about the server in a refusal beyond the limits (no stack, no binding names)', async () => {
        const { zip } = shapedPackage({ inspections: 1, writes: DEFAULT_IMPORT_LIMITS.outbox + 1, photos: 0 }, manager.id);
        const text = await (await importPackage(manager.token, zip)).text();
        expect(text).toContain('PACKAGE_TOO_LARGE');
        expect(text).not.toMatch(/stack|at \w+ \(|D1|R2|TENANT_CACHE|INSPECTION_DOC/);
    });

    // ── environment overrides ─────────────────────────────────────────────────

    it('honours NATIVE_IMPORT_MAX_OUTBOX: 6 writes refused, 5 imported', async () => {
        const env = { NATIVE_IMPORT_MAX_OUTBOX: '5' };
        await refusedWithoutWriting({ inspections: 1, writes: 6, photos: 0 }, 'outbox', 5, env);
        const ok = await importPackage(manager.token, shapedPackage({ inspections: 1, writes: 5, photos: 0 }, manager.id).zip, { env });
        expect(ok.status, await ok.clone().text()).toBe(200);
    });

    it('can raise a limit above the default (21 writes imports with NATIVE_IMPORT_MAX_OUTBOX=30)', async () => {
        const zip = shapedPackage({ inspections: 1, writes: DEFAULT_IMPORT_LIMITS.outbox + 1, photos: 0 }, manager.id).zip;
        expect((await importPackage(manager.token, zip)).status).toBe(422);
        const raised = await importPackage(manager.token, zip, { env: { NATIVE_IMPORT_MAX_OUTBOX: '30' } });
        expect(raised.status, await raised.clone().text()).toBe(200);
    });

    it.each(['abc', '', '-1', '2.5', '5 writes'])('ignores the invalid value %j and keeps the default', async (value) => {
        const env = { NATIVE_IMPORT_MAX_OUTBOX: value };
        await refusedWithoutWriting({ inspections: 1, writes: DEFAULT_IMPORT_LIMITS.outbox + 1, photos: 0 }, 'outbox', DEFAULT_IMPORT_LIMITS.outbox, env);
        const ok = await importPackage(manager.token, shapedPackage({ inspections: 1, writes: DEFAULT_IMPORT_LIMITS.outbox, photos: 0 }, manager.id).zip, { env });
        expect(ok.status, await ok.clone().text()).toBe(200);
    });

    it('clamps an extreme value: 0 still admits one write and no more; a huge value stops at the ceiling', async () => {
        const low = { NATIVE_IMPORT_MAX_OUTBOX: '0' };
        await refusedWithoutWriting({ inspections: 1, writes: 2, photos: 0 }, 'outbox', 1, low);
        const one = await importPackage(manager.token, shapedPackage({ inspections: 1, writes: 1, photos: 0 }, manager.id).zip, { env: low });
        expect(one.status, await one.clone().text()).toBe(200);

        const high = { NATIVE_IMPORT_MAX_OUTBOX: '99999999' };
        await refusedWithoutWriting({ inspections: 1, writes: 501, photos: 0 }, 'outbox', 500, high);
    });
});
