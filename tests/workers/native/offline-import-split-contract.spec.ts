/**
 * The contract behind "Splitting a package that one inspection keeps refusing"
 * (docs/develop/native-clients.md): a refusal that is about ONE inspection names it
 * in `error.details`, so a client can take it out and send the rest; a refusal that
 * is about the package as a whole names none, so a client does not try to split
 * around something that splitting cannot fix.
 *
 * Three groups, each answered by the real app in workerd with a browser session:
 *
 *  1. Refusals the document lists (403, 404, 400 different report, 409 deleted):
 *     `details.inspectionId` is present and names the right inspection.
 *  2. Failures while applying (400, 422, 503 from the results object): `details`
 *     carries `{ inspectionId, reason }`.
 *  3. Whole-package refusals: `details` carries neither `inspectionId` nor
 *     `inspectionIds`.
 *
 * Every refusal is paired with a positive control: the same package with the named
 * inspection taken out (groups 1 and 2) or with the fault repaired (group 3) is
 * imported with 200, so a harness that refuses everything cannot pass, and a
 * negative assertion on `details` is only believed next to a case where the same
 * reader does find the id.
 */
import { env as testEnv, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import * as Y from 'yjs';
import app from '../../../server/index';
import { buildKeyring, signJwt } from '../../../server/lib/jwt-keyring';
import { collabDocName } from '../../../server/lib/collab/doc-name';
import { seedResultsDoc, applyItemPatch, projectResults } from '@core/field-ui/shared/results-doc';
import type { InspectionDocDO } from '../../../server/durable-objects/inspection-doc';
import { applyMigrations } from '../migration-replay';
import { PACKAGE_MAX_AGE_DAYS } from '@core/offline-package';
import { buildPackage, type PackageSpec } from '../../unit/helpers/offline-package-fixture';

const migrationSql = import.meta.glob('../../../migrations/*.sql', {
    query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

interface TestBindings { DB: D1Database; INSPECTION_DOC: DurableObjectNamespace<InspectionDocDO> }
const b = testEnv as unknown as TestBindings;

const TENANT = 'split-contract-tenant';
const OTHER_TENANT = 'split-contract-other';
const TEMPLATE = 'split-contract-template';
const KEY = '_default:sec1:item1';
const DAY_MS = 24 * 60 * 60 * 1000;

type Role = 'owner' | 'manager' | 'inspector';
interface Member { id: string; jwt: string }
interface Created { id: string; reportId: string }
interface ErrorBody { code?: string; message?: string; details?: Record<string, unknown> }

let seq = 0;
const fresh = (prefix: string): string => `${prefix}-${++seq}-${crypto.randomUUID().slice(0, 6)}`;
let keyring: Awaited<ReturnType<typeof buildKeyring>>;
let owner: Member;
let manager: Member;

async function addMember(role: Role, overrides: Record<string, boolean> | null = null): Promise<Member> {
    const id = fresh(`sc-${role}`);
    await b.DB.prepare('INSERT INTO users (id, tenant_id, email, password_hash, name, role, permission_overrides, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, TENANT, `${id}@example.test`, 'x', id, role, overrides ? JSON.stringify(overrides) : null, Date.now()).run();
    return { id, jwt: await signJwt({ sub: id, role, 'custom:userRole': role, 'custom:tenantId': TENANT }, keyring) };
}

const pending: Promise<unknown>[] = [];
const ctx = { waitUntil: (p: Promise<unknown>) => { pending.push(p); }, passThroughOnException: () => undefined } as unknown as ExecutionContext;

async function call(path: string, init: RequestInit = {}, env: Record<string, unknown> = {}): Promise<Response> {
    const res = await app.fetch(new Request(`http://x${path}`, init), { ...testEnv, ...env } as never, ctx);
    await Promise.all(pending.splice(0));
    return res;
}

/** What a browser sends: the session cookie and nothing else. */
function importAs(who: Member, zip: Uint8Array, env: Record<string, unknown> = {}): Promise<Response> {
    return call('/api/client/import', {
        method: 'POST',
        headers: { 'content-type': 'application/zip', 'content-length': String(zip.byteLength), cookie: `__Host-inspector_token=${who.jwt}` },
        body: new Uint8Array(zip),
    }, env);
}

async function createInspection(by: Member): Promise<Created> {
    const id = fresh('sc-insp');
    const res = await call('/api/inspections', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${by.jwt}` },
        body: JSON.stringify({ id, propertyAddress: '1 Contract Road, Anytown', templateId: TEMPLATE, date: '2026-10-01T10:00:00.000Z' }),
    });
    expect(res.status, await res.clone().text()).toBe(201);
    const row = await b.DB.prepare('SELECT id FROM reports WHERE inspection_id = ? AND tenant_id = ?').bind(id, TENANT).first<{ id: string }>();
    return { id, reportId: row!.id };
}

function deviceState(rating = 'RR'): Uint8Array {
    const doc = new Y.Doc();
    seedResultsDoc(doc, [{ findingKey: KEY }]);
    applyItemPatch(doc, KEY, 'rating', rating);
    return Y.encodeStateAsUpdate(doc);
}

const stubFor = (insp: Created) => b.INSPECTION_DOC.get(b.INSPECTION_DOC.idFromName(collabDocName(TENANT, insp.reportId)));
async function ratingOf(insp: Created): Promise<string | undefined> {
    return (await runInDurableObject(stubFor(insp), (i: InspectionDocDO) => projectResults((i as unknown as { doc: Y.Doc }).doc)))[KEY]?.rating;
}

function pkg(by: Member, parts: Created[], extra: Partial<PackageSpec> = {}): PackageSpec {
    return {
        tenantId: TENANT, exportedBy: by.id,
        inspections: parts.map((p) => ({ id: p.id, reportId: p.reportId })),
        yjs: Object.fromEntries(parts.map((p) => [p.id, deviceState()])),
        ...extra,
    };
}

async function errorOf(res: Response): Promise<ErrorBody> {
    return ((await res.json()) as { error: ErrorBody }).error;
}

/** Exactly what a splitting client reads: the ids a refusal names. */
function named(error: ErrorBody): string[] {
    const d = error.details ?? {};
    const many = Array.isArray(d.inspectionIds) ? d.inspectionIds.filter((v): v is string => typeof v === 'string') : [];
    return many.length > 0 ? many : typeof d.inspectionId === 'string' ? [d.inspectionId] : [];
}

async function ok(res: Response): Promise<void> {
    expect(res.status, await res.clone().text()).toBe(200);
}

beforeAll(async () => {
    await applyMigrations(b.DB, migrationSql);
    await b.DB.exec('CREATE TABLE IF NOT EXISTS test_queue_log (id TEXT PRIMARY KEY, type TEXT, body TEXT, received_at INTEGER);');
    const now = Date.now();
    for (const t of [TENANT, OTHER_TENANT]) await b.DB.prepare('INSERT OR IGNORE INTO tenants (id, slug, created_at) VALUES (?, ?, ?)').bind(t, t, now).run();
    await b.DB.prepare('INSERT OR IGNORE INTO templates (id, tenant_id, name, version, schema, created_at) VALUES (?, ?, ?, 1, ?, ?)')
        .bind(TEMPLATE, TENANT, 'Standard', JSON.stringify({ sections: [] }), now).run();
    keyring = await buildKeyring(testEnv as never);
    owner = await addMember('owner');
    manager = await addMember('manager');
});

describe('a refusal about one inspection names it, and the package without it imports', () => {
    it('403: an inspector who cannot edit one of them', async () => {
        const importer = await addMember('inspector');
        const mine = await createInspection(importer);
        const theirs = await createInspection(await addMember('inspector'));

        const res = await importAs(importer, buildPackage(pkg(importer, [mine, theirs])));
        expect(res.status).toBe(403);
        expect(named(await errorOf(res))).toEqual([theirs.id]);
        expect(await ratingOf(mine)).toBeUndefined();

        await ok(await importAs(importer, buildPackage(pkg(importer, [mine]))));
        expect(await ratingOf(mine)).toBe('RR');
    });

    it('404: an inspection that does not exist and that the package does not create', async () => {
        const real = await createInspection(owner);
        const ghost: Created = { id: fresh('sc-ghost'), reportId: 'device-report' };

        const res = await importAs(manager, buildPackage(pkg(manager, [real, ghost])));
        expect(res.status).toBe(404);
        const error = await errorOf(res);
        expect(named(error)).toEqual([ghost.id]);
        expect(await ratingOf(real)).toBeUndefined();

        await ok(await importAs(manager, buildPackage(pkg(manager, [real]))));
        expect(await ratingOf(real)).toBe('RR');
    });

    it('404: a caller limited to assigned inspections gets the same answer for one that exists but is not theirs', async () => {
        const restricted = await addMember('inspector', { viewAllInspections: false });
        const mine = await createInspection(restricted);
        const theirs = await createInspection(owner);
        const ghost: Created = { id: fresh('sc-ghost'), reportId: 'device-report' };

        const hidden = await importAs(restricted, buildPackage(pkg(restricted, [mine, theirs])));
        const absent = await importAs(restricted, buildPackage(pkg(restricted, [mine, ghost])));
        expect([hidden.status, absent.status]).toEqual([404, 404]);
        const hiddenError = await errorOf(hidden);
        const absentError = await errorOf(absent);
        expect(named(hiddenError)).toEqual([theirs.id]);
        expect(named(absentError)).toEqual([ghost.id]);
        // The two are indistinguishable apart from the id the caller sent.
        expect(hiddenError.message?.replace(theirs.id, '<id>')).toBe(absentError.message?.replace(ghost.id, '<id>'));

        await ok(await importAs(restricted, buildPackage(pkg(restricted, [mine]))));
        expect(await ratingOf(mine)).toBe('RR');
    });

    it('404: an inspection that exists but has no report to open', async () => {
        const reportless = await createInspection(owner);
        const real = await createInspection(owner);
        await b.DB.prepare('DELETE FROM reports WHERE inspection_id = ? AND tenant_id = ?').bind(reportless.id, TENANT).run();

        const res = await importAs(manager, buildPackage(pkg(manager, [real, reportless])));
        expect(res.status).toBe(404);
        const error = await errorOf(res);
        expect(error.message).toContain('cannot be opened for import');
        expect(named(error)).toEqual([reportless.id]);

        await ok(await importAs(manager, buildPackage(pkg(manager, [real]))));
    });

    it('400: an inspection exported from a different report', async () => {
        const real = await createInspection(owner);
        const stale = await createInspection(owner);

        const res = await importAs(manager, buildPackage({ ...pkg(manager, [real, stale]), inspections: [
            { id: real.id, reportId: real.reportId }, { id: stale.id, reportId: 'some-other-report' },
        ] }));
        expect(res.status).toBe(400);
        expect(named(await errorOf(res))).toEqual([stale.id]);
        expect(await ratingOf(real)).toBeUndefined();

        await ok(await importAs(manager, buildPackage(pkg(manager, [real]))));
        await ok(await importAs(manager, buildPackage(pkg(manager, [stale]))));
    });

    it('409 PACKAGE_INSPECTION_DELETED: names the first and lists every deleted one', async () => {
        // The record that an earlier import created an inspection is kept under its queued write's key.
        const keyOf = (id: string): string => `create-${id}`;
        const createPackage = (id: string): Uint8Array => buildPackage({
            tenantId: TENANT, exportedBy: owner.id, inspections: [{ id, reportId: 'device-report' }], yjs: { [id]: deviceState() },
            outbox: [{ idempotencyKey: keyOf(id), op: 'inspection.create', payload: { id, propertyAddress: '2 Created Offline Road', templateId: TEMPLATE } }],
        });
        const ids = [fresh('sc-del'), fresh('sc-del')];
        for (const id of ids) await ok(await importAs(owner, createPackage(id)));
        for (const id of ids) {
            const gone = await call(`/api/inspections/${id}`, { method: 'DELETE', headers: { authorization: `Bearer ${owner.jwt}` } });
            expect(gone.status, await gone.clone().text()).toBe(200);
        }
        const keep = await createInspection(owner);

        const both = buildPackage({
            tenantId: TENANT, exportedBy: owner.id,
            inspections: [...ids.map((id) => ({ id, reportId: 'device-report' })), { id: keep.id, reportId: keep.reportId }],
            yjs: Object.fromEntries([...ids, keep.id].map((id) => [id, deviceState()])),
            outbox: ids.map((id) => ({ idempotencyKey: keyOf(id), op: 'inspection.create', payload: { id, propertyAddress: '2 Created Offline Road', templateId: TEMPLATE } })),
        });
        const res = await importAs(owner, both);
        expect(res.status).toBe(409);
        const error = await errorOf(res);
        expect(error.code).toBe('PACKAGE_INSPECTION_DELETED');
        expect(error.details?.inspectionId).toBe(ids[0]);
        expect([...named(error)].sort()).toEqual([...ids].sort());
        expect(await ratingOf(keep)).toBeUndefined();

        await ok(await importAs(owner, buildPackage(pkg(owner, [keep]))));
        expect(await ratingOf(keep)).toBe('RR');
    });
});

describe('a failure while applying names the inspection and the reason', () => {
    const stateFault: Array<[string, number, string, () => Uint8Array]> = [
        ['an empty results entry', 400, 'empty', () => new Uint8Array(0)],
        ['bytes that are not a Yjs update', 400, 'malformed', () => new Uint8Array([255, 255, 255, 255, 1, 2, 3])],
        ['an update that depends on state the server does not have', 422, 'unmet_dependencies', () => {
            const doc = new Y.Doc();
            seedResultsDoc(doc, [{ findingKey: KEY }]);
            const sinceSeed = Y.encodeStateVector(doc);
            applyItemPatch(doc, KEY, 'rating', 'RR');
            return Y.encodeStateAsUpdate(doc, sinceSeed);
        }],
    ];

    it.each(stateFault)('%s: %i with reason %s, and the corrected package then imports', async (_name, status, reason, bad) => {
        const target = await createInspection(owner);
        const res = await importAs(manager, buildPackage({ ...pkg(manager, [target]), yjs: { [target.id]: bad() } }));
        expect(res.status, await res.clone().text()).toBe(status);
        const error = await errorOf(res);
        expect(error.details).toEqual({ inspectionId: target.id, reason });
        expect(named(error)).toEqual([target.id]);
        expect(await ratingOf(target)).toBeUndefined();

        await ok(await importAs(manager, buildPackage(pkg(manager, [target]))));
        expect(await ratingOf(target)).toBe('RR');
    });

    it('503: the results object cannot persist, and a retry after it is evicted imports', async () => {
        const target = await createInspection(owner);
        const zip = buildPackage(pkg(manager, [target]));
        await runInDurableObject(stubFor(target), (i: InspectionDocDO) => {
            (i as unknown as { persist: () => Promise<void> }).persist = () => Promise.reject(new Error('d1 unavailable'));
        });

        const res = await importAs(manager, zip);
        expect(res.status, await res.clone().text()).toBe(503);
        expect((await errorOf(res)).details).toEqual({ inspectionId: target.id, reason: 'persist_failed' });

        await runInDurableObject(stubFor(target), (_i, state) => {
            try { state.abort('simulated eviction'); } catch { /* the abort surfaces as an error to the caller */ }
        }).catch(() => undefined);
        await ok(await importAs(manager, zip));
        expect(await ratingOf(target)).toBe('RR');
    });
});

describe('a refusal of the whole package names no inspection, and the repaired package imports', () => {
    it('reads the same way a splittable refusal does (the reader finds an id there and none here)', async () => {
        const real = await createInspection(owner);
        const ghost: Created = { id: fresh('sc-ghost'), reportId: 'device-report' };
        expect(named(await errorOf(await importAs(manager, buildPackage(pkg(manager, [real, ghost])))))).toEqual([ghost.id]);
        expect(named(await errorOf(await importAs(manager, buildPackage({ ...pkg(manager, [real]), tenantId: OTHER_TENANT }))))).toEqual([]);
    });

    it('403: a package from a different workspace', async () => {
        const real = await createInspection(owner);
        const res = await importAs(manager, buildPackage({ ...pkg(manager, [real]), tenantId: OTHER_TENANT }));
        expect(res.status).toBe(403);
        const error = await errorOf(res);
        expect(error.message).toContain('different workspace');
        expect(error.details ?? {}).not.toHaveProperty('inspectionId');
        expect(error.details ?? {}).not.toHaveProperty('inspectionIds');
        await ok(await importAs(manager, buildPackage(pkg(manager, [real]))));
    });

    it('403: a manager whose report editing is switched off', async () => {
        const restricted = await addMember('manager', { editReports: false });
        const real = await createInspection(owner);
        const zip = buildPackage(pkg(restricted, [real]));
        const res = await importAs(restricted, zip);
        expect(res.status).toBe(403);
        const refused = await errorOf(res);
        expect(refused.message).toContain('Edit report content');
        expect(named(refused)).toEqual([]);
        expect(await ratingOf(real)).toBeUndefined();
        await ok(await importAs(manager, zip));
    });

    it('400: an entry that names an inspection outside the manifest, and a declared inspection without its state', async () => {
        const real = await createInspection(owner);
        const other = await createInspection(owner);
        const base = pkg(manager, [real]);
        // Each fault is paired with the stable part of the sentence the server gives for it, so a 400
        // for some other reason cannot pass for the one under test.
        const faults: Array<[PackageSpec, string]> = [
            [{ ...base, outbox: [{ idempotencyKey: fresh('k'), op: 'inspection.update', payload: { id: other.id, propertyAddress: '9 Outside Road' } }] }, 'outbox names an inspection outside the manifest'],
            [{ ...base, media: [{ pendingId: 'p1', inspectionId: other.id, contentType: 'image/jpeg' }] }, 'media index names an inspection outside the manifest'],
            [{ ...base, yjs: {} }, `no Yjs state for inspection ${real.id}`],
            [{ ...base, outbox: [{ idempotencyKey: fresh('k'), op: 'inspection.delete', payload: { id: real.id } }] }, 'outbox is invalid'],
        ];
        for (const [fault, sentence] of faults) {
            const res = await importAs(manager, buildPackage(fault));
            expect(res.status, await res.clone().text()).toBe(400);
            const error = await errorOf(res);
            expect(error.message).toContain(sentence);
            expect(named(error)).toEqual([]);
        }
        const notZip = await importAs(manager, new TextEncoder().encode('definitely not a zip archive'));
        expect(notZip.status).toBe(400);
        const notZipError = await errorOf(notZip);
        expect(notZipError.message).toContain('not a valid zip archive');
        expect(named(notZipError)).toEqual([]);

        await ok(await importAs(manager, buildPackage(base)));
    });

    it('422: a package that is too old, or dated ahead of the clock', async () => {
        const real = await createInspection(owner);
        const dated = (offsetMs: number) => buildPackage({ ...pkg(manager, [real]), manifest: { exportedAt: new Date(Date.now() + offsetMs).toISOString() } });
        const cases: Array<[string, number, string]> = [
            ['PACKAGE_EXPIRED', -(PACKAGE_MAX_AGE_DAYS + 5) * DAY_MS, 'maxAgeDays'],
            ['PACKAGE_FROM_THE_FUTURE', 3 * DAY_MS, 'maxFutureSkewDays'],
        ];
        for (const [code, offset, detail] of cases) {
            const res = await importAs(manager, dated(offset));
            expect(res.status, code).toBe(422);
            const error = await errorOf(res);
            expect(error.code).toBe(code);
            expect(error.details).toHaveProperty(detail);
            expect(named(error)).toEqual([]);
        }
        await ok(await importAs(manager, dated(-DAY_MS)));
    });

    it('422: a package over a count limit names the limit, not an inspection', async () => {
        const a = await createInspection(owner);
        const c = await createInspection(owner);
        const zip = buildPackage(pkg(manager, [a, c]));
        const res = await importAs(manager, zip, { NATIVE_IMPORT_MAX_INSPECTIONS: '1' });
        expect(res.status, await res.clone().text()).toBe(422);
        const error = await errorOf(res);
        expect(error.code).toBe('PACKAGE_TOO_LARGE');
        expect(error.details).toHaveProperty('limits');
        expect(named(error)).toEqual([]);
        await ok(await importAs(manager, zip));
    });
});
