/**
 * Importing an offline package, end to end in workerd.
 *
 * What is real: the Hono app and its whole middleware chain, D1 with the real
 * migrations, the R2 bucket, the results Durable Object (so the forced snapshot,
 * the persist and the pending-photo swap actually run) and the idempotency layer.
 * What is stood in: the OAuth provider's token lookup, which maps a bearer string
 * to the grant props a consent would have written. Membership is NOT stood in:
 * `resolveNativeToken` re-reads the users row on every request, which is what the
 * removed-member case relies on.
 *
 * Every refusal is paired with a positive control (the same package minus the
 * fault imports) so a harness that rejects everything cannot pass.
 */
import { env as testEnv, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect, beforeAll, vi } from 'vitest';
import * as Y from 'yjs';
import { drizzle } from 'drizzle-orm/d1';
import { deleteInspectionCascade } from '../../../server/services/inspection/inspection-cascade';
import app from '../../../server/index';
import { buildKeyring, signJwt } from '../../../server/lib/jwt-keyring';
import { NATIVE_SCOPE, type NativeProps } from '../../../server/lib/auth/native-token';
import { collabDocName } from '../../../server/lib/collab/doc-name';
import { seedResultsDoc, applyItemPatch, pushPendingPhoto, projectResults } from '../../../server/lib/collab/results-doc';
import type { InspectionDocDO } from '../../../server/durable-objects/inspection-doc';
import type { PhotoEntry } from '../../../server/lib/collab/results-doc.types';
import { InspectionService } from '../../../server/services/inspection.service';
import { applyMigrations } from '../migration-replay';
import { PACKAGE_MAX_AGE_DAYS, PACKAGE_MAX_FUTURE_SKEW_DAYS, APPLIED_RECORD_RETENTION_DAYS, APPLIED_RECORD_SWEEP_BATCH } from '../../../server/lib/native/offline-package';
import { fingerprint } from '../../../server/lib/idempotency/fingerprint';
import { buildPackage, declareEntrySize, JPEG_BYTES, type PackageSpec } from '../../unit/helpers/offline-package-fixture';

const migrationSql = import.meta.glob('../../../migrations/*.sql', {
    query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

interface TestBindings {
    DB: D1Database;
    PHOTOS: R2Bucket;
    INSPECTION_DOC: DurableObjectNamespace<InspectionDocDO>;
}
const b = testEnv as unknown as TestBindings;

const TENANT = 'import-tenant';
const OTHER_TENANT = 'import-other-tenant';
const TEMPLATE = 'import-template';
const KEY = '_default:sec1:item1';

// ─── Identities ──────────────────────────────────────────────────────────────

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

async function addMember(role: Member['role']): Promise<Member> {
    const id = fresh(`user-${role}`);
    await b.DB.prepare('INSERT INTO users (id, tenant_id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(id, TENANT, `${id}@example.test`, 'x', id, role, Date.now()).run();
    const token = `u:g:${id}`;
    grants.set(token, { kind: 'native', userId: id, tenantId: TENANT, role, lastUsedAt: 0, grantedAt: 0 });
    return { id, token, role };
}

let ownerJwt = '';

// ─── Calling the real app ────────────────────────────────────────────────────

const pending: Promise<unknown>[] = [];
const ctx = {
    waitUntil: (p: Promise<unknown>) => { pending.push(p); },
    passThroughOnException: () => undefined,
} as unknown as ExecutionContext;

async function call(path: string, init: RequestInit & { token?: string; env?: Record<string, unknown> } = {}): Promise<Response> {
    const { token, env: extraEnv, ...rest } = init;
    const headers = new Headers(rest.headers);
    if (token) headers.set('authorization', `Bearer ${token}`);
    const env = { ...testEnv, NATIVE_CLIENT_ENABLED: 'true', OAUTH_PROVIDER: provider, ...extraEnv };
    const res = await app.fetch(new Request(`http://x${path}`, { ...rest, headers }), env as never, ctx);
    await Promise.all(pending.splice(0));
    return res;
}

interface ImportBody { success: boolean; data?: { inspections: number; photos: number; outbox: { applied: number; skipped: number; failed: Array<{ idempotencyKey: string; op: string; inspectionId: string; status: number }> }; yjs: { changed: number; unchanged: number } } }

function importPackage(token: string, zip: Uint8Array, opts: { headers?: Record<string, string>; contentLength?: string | null; env?: Record<string, unknown> } = {}): Promise<Response> {
    const headers = new Headers({ 'content-type': 'application/zip', ...opts.headers });
    if (opts.contentLength !== null) headers.set('content-length', opts.contentLength ?? String(zip.byteLength));
    return call('/api/client/import', { method: 'POST', token, headers, body: new Uint8Array(zip), ...(opts.env ? { env: opts.env } : {}) });
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

interface Created { id: string; reportId: string }

async function createInspection(by: Member, address = '1 Original Road, Anytown'): Promise<Created> {
    const id = fresh('insp');
    const res = await call('/api/inspections', {
        method: 'POST', token: by.token, headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, propertyAddress: address, templateId: TEMPLATE, date: '2026-10-01T10:00:00.000Z' }),
    });
    expect(res.status, await res.clone().text()).toBe(201);
    const row = await b.DB.prepare('SELECT id FROM reports WHERE inspection_id = ? AND tenant_id = ?').bind(id, TENANT).first<{ id: string }>();
    expect(row?.id, 'creating an inspection must also create its primary report').toBeTruthy();
    return { id, reportId: row!.id };
}

function stubFor(insp: Created): DurableObjectStub<InspectionDocDO> {
    return b.INSPECTION_DOC.get(b.INSPECTION_DOC.idFromName(collabDocName(TENANT, insp.reportId)));
}

/** What a device holds after working offline: one rated item and one pending photo. */
function deviceState(rating: string, pendingId?: string): Uint8Array {
    const doc = new Y.Doc();
    seedResultsDoc(doc, [{ findingKey: KEY }]);
    applyItemPatch(doc, KEY, 'rating', rating);
    if (pendingId) {
        const photo: PhotoEntry & { pendingId: string } = { key: '', pendingUpload: true, pendingId, pendingKind: 'photo', mediaId: `m-${pendingId}` };
        pushPendingPhoto(doc, KEY, photo);
    }
    return Y.encodeStateAsUpdate(doc);
}

async function projection(insp: Created) {
    return runInDurableObject(stubFor(insp), (instance: InspectionDocDO) =>
        projectResults((instance as unknown as { doc: Y.Doc }).doc));
}

async function ratingOf(insp: Created): Promise<string | undefined> {
    return (await projection(insp))[KEY]?.rating;
}

async function snapshotCount(insp: Created): Promise<number> {
    const res = await stubFor(insp).fetch('https://do.local/snapshots', {
        headers: { 'x-tenant-id': TENANT, 'x-inspection-id': insp.id, 'x-report-id': insp.reportId },
    });
    return ((await res.json()) as unknown[]).length;
}

async function addressOf(id: string): Promise<string | null> {
    const row = await b.DB.prepare('SELECT property_address AS a FROM inspections WHERE id = ?').bind(id).first<{ a: string }>();
    return row?.a ?? null;
}

async function inspectionCount(): Promise<number> {
    const row = await b.DB.prepare('SELECT count(*) AS n FROM inspections WHERE tenant_id = ?').bind(TENANT).first<{ n: number }>();
    return row?.n ?? 0;
}

async function photoKeys(insp: Created): Promise<string[]> {
    const listed = await b.PHOTOS.list({ prefix: `${TENANT}/inspections/${insp.id}/photos/` });
    return listed.objects.map((o) => o.key).sort();
}

async function recordedCount(key: string): Promise<number> {
    const row = await b.DB.prepare('SELECT count(*) AS n FROM offline_import_applied WHERE tenant_id = ? AND idempotency_key = ?').bind(TENANT, key).first<{ n: number }>();
    return row?.n ?? 0;
}

async function auditRows(): Promise<Array<{ user_id: string | null; metadata: string | null }>> {
    const rows = await b.DB.prepare("SELECT user_id, metadata FROM audit_logs WHERE tenant_id = ? AND action = 'native.offline_import'")
        .bind(TENANT).all<{ user_id: string | null; metadata: string | null }>();
    return rows.results;
}

function pkg(creator: { exportedBy: string }, insp: Created, extra: Partial<PackageSpec> = {}): PackageSpec {
    return {
        tenantId: TENANT,
        exportedBy: creator.exportedBy,
        inspections: [{ id: insp.id, reportId: insp.reportId }],
        yjs: { [insp.id]: deviceState('RR', 'pend-1') },
        media: [{ pendingId: 'pend-1', inspectionId: insp.id, contentType: 'image/jpeg' }],
        ...extra,
    };
}

async function body(res: Response): Promise<ImportBody> {
    return (await res.json()) as ImportBody;
}

describe('POST /api/client/import', () => {
    let owner: Member;
    let manager: Member;
    let author: Member;

    beforeAll(async () => {
        await applyMigrations(b.DB, migrationSql);
        // Creating an inspection publishes sync events; the test worker's queue consumer logs them here.
        await b.DB.exec('CREATE TABLE IF NOT EXISTS test_queue_log (id TEXT PRIMARY KEY, type TEXT, body TEXT, received_at INTEGER);');
        const now = Date.now();
        await b.DB.prepare('INSERT OR IGNORE INTO tenants (id, slug, created_at) VALUES (?, ?, ?)').bind(TENANT, 'import-tenant', now).run();
        await b.DB.prepare('INSERT OR IGNORE INTO tenants (id, slug, created_at) VALUES (?, ?, ?)').bind(OTHER_TENANT, 'import-other', now).run();
        await b.DB.prepare('INSERT OR IGNORE INTO templates (id, tenant_id, name, version, schema, created_at) VALUES (?, ?, ?, 1, ?, ?)')
            .bind(TEMPLATE, TENANT, 'Standard', JSON.stringify({ sections: [] }), now).run();
        owner = await addMember('owner');
        manager = await addMember('manager');
        author = await addMember('inspector');
        const keyring = await buildKeyring(testEnv as never);
        ownerJwt = await signJwt({ sub: owner.id, role: 'owner', 'custom:userRole': 'owner', 'custom:tenantId': TENANT }, keyring);
    });

    // ── 1. A exports, B imports ────────────────────────────────────────────────

    it('imports a package exported by another member: writes, results, photo and audit', async () => {
        const insp = await createInspection(author);
        const zip = buildPackage(pkg({ exportedBy: author.id }, insp, {
            outbox: [
                { idempotencyKey: fresh('k'), op: 'inspection.update', payload: { id: insp.id, propertyAddress: '99 Changed Avenue, Town' } },
                { idempotencyKey: fresh('k'), op: 'inspection.complete', payload: { id: insp.id } },
            ],
        }));

        // Before: nothing of the package is visible.
        expect(await addressOf(insp.id)).toBe('1 Original Road, Anytown');
        expect(await ratingOf(insp)).toBeUndefined();
        expect(await photoKeys(insp)).toEqual([]);

        const res = await importPackage(manager.token, zip);
        expect(res.status, await res.clone().text()).toBe(200);
        expect(await body(res)).toEqual({
            success: true,
            data: { inspections: 1, photos: 1, outbox: { applied: 2, skipped: 0, failed: [] }, yjs: { changed: 1, unchanged: 0 } },
        });

        expect(await addressOf(insp.id)).toBe('99 Changed Avenue, Town');
        expect(await ratingOf(insp)).toBe('RR');
        const keys = await photoKeys(insp);
        expect(keys).toEqual([`${TENANT}/inspections/${insp.id}/photos/pend-1.jpg`]);

        // The pending entry was swapped for the stored key.
        const photos = (await projection(insp))[KEY]?.photos as PhotoEntry[] | undefined;
        expect(photos?.map((p) => p.key)).toEqual(keys);
        expect(photos?.some((p) => p.pendingUpload)).toBe(false);
        expect(photos?.some((p) => p.pendingId)).toBe(false);
        const stored = await b.PHOTOS.get(keys[0]!);
        expect(new Uint8Array(await stored!.arrayBuffer())).toEqual(JPEG_BYTES);

        // The import forced one snapshot of the pre-import document first.
        expect(await snapshotCount(insp)).toBe(1);

        // Audited as the importer, naming the exporter only as a claim.
        const rows = (await auditRows()).filter((r) => (r.metadata ?? '').includes(insp.id) || (r.metadata ?? '').includes(author.id));
        expect(rows).toHaveLength(1);
        expect(rows[0]!.user_id).toBe(manager.id);
        expect(JSON.parse(rows[0]!.metadata ?? '{}')).toMatchObject({ exportedBy: author.id, inspections: 1, photos: 1, applied: 2, skipped: 0, failed: 0, changed: 1 });
    });

    it('creates an inspection the package carries, then fills it', async () => {
        const id = fresh('insp-new');
        const create = { idempotencyKey: fresh('k'), op: 'inspection.create', payload: { id, propertyAddress: '5 Created Offline Rd', templateId: TEMPLATE, date: '2026-10-02T10:00:00.000Z' } };
        // A device cannot know the server's report id for an inspection it created; the manifest value is a placeholder.
        const spec: PackageSpec = {
            tenantId: TENANT, exportedBy: author.id, inspections: [{ id, reportId: 'device-report' }],
            yjs: { [id]: deviceState('SAT') }, outbox: [create],
        };
        const before = await inspectionCount();
        const res = await importPackage(manager.token, buildPackage(spec));
        expect(res.status, await res.clone().text()).toBe(200);
        expect((await body(res)).data).toMatchObject({ outbox: { applied: 1, skipped: 0 }, yjs: { changed: 1, unchanged: 0 } });
        expect(await inspectionCount()).toBe(before + 1);
        const reportRow = await b.DB.prepare('SELECT id FROM reports WHERE inspection_id = ?').bind(id).first<{ id: string }>();
        expect(await ratingOf({ id, reportId: reportRow!.id })).toBe('SAT');
    });

    it('puts the document of a created inspection in the server primary report, whatever report id the manifest claims', async () => {
        // The victim is an unrelated inspection whose report id the package claims as its own.
        const victim = await createInspection(author);
        const id = fresh('insp-claims');
        const spec: PackageSpec = {
            tenantId: TENANT, exportedBy: author.id, inspections: [{ id, reportId: victim.reportId }],
            yjs: { [id]: deviceState('SAT') },
            outbox: [{ idempotencyKey: fresh('k'), op: 'inspection.create', payload: { id, propertyAddress: '4 Claims Court, Town', templateId: TEMPLATE } }],
        };
        const victimSnapshots = await snapshotCount(victim);
        const res = await importPackage(manager.token, buildPackage(spec));
        expect(res.status, await res.clone().text()).toBe(200);

        const own = await b.DB.prepare('SELECT id FROM reports WHERE inspection_id = ? AND tenant_id = ?').bind(id, TENANT).first<{ id: string }>();
        expect(own!.id).not.toBe(victim.reportId);
        expect(await ratingOf({ id, reportId: own!.id })).toBe('SAT');
        // The claimed report was not touched: no rating merged in, no snapshot taken, nothing persisted for it.
        expect(await ratingOf(victim)).toBeUndefined();
        expect(await snapshotCount(victim)).toBe(victimSnapshots);
        const stored = await b.DB.prepare('SELECT data FROM inspection_results WHERE report_id = ?').bind(victim.reportId).all<{ data: string }>();
        expect(stored.results.filter((r) => r.data.includes('"SAT"'))).toEqual([]);
    });

    it('refuses a package that names a missing inspection it does not create (positive control: creating it)', async () => {
        const id = fresh('insp-missing');
        const base: PackageSpec = { tenantId: TENANT, exportedBy: author.id, inspections: [{ id, reportId: 'r' }], yjs: { [id]: deviceState('RR') } };
        const refused = await importPackage(manager.token, buildPackage(base));
        expect(refused.status).toBe(404);
        expect(((await refused.json()) as { error: { details: { inspectionId: string } } }).error.details).toEqual({ inspectionId: id });
        const ok = await importPackage(manager.token, buildPackage({
            ...base,
            outbox: [{ idempotencyKey: fresh('k'), op: 'inspection.create', payload: { id, propertyAddress: '7 Now Created Rd', templateId: TEMPLATE } }],
        }));
        expect(ok.status, await ok.clone().text()).toBe(200);
    });

    // ── 2. The exporter is removed ────────────────────────────────────────────

    it('still imports a package whose exporter has since been removed, and that exporter\'s token is dead', async () => {
        const exporter = await addMember('inspector');
        const insp = await createInspection(exporter);
        const zip = buildPackage(pkg({ exportedBy: exporter.id }, insp));

        // Control: before removal the exporter's own token works.
        const before = await call('/api/client/session', { token: exporter.token });
        expect(before.status).toBe(200);

        const removal = await call(`/api/team/members/${exporter.id}`, { method: 'DELETE', token: ownerJwt });
        expect(removal.status, await removal.clone().text()).toBe(200);

        const after = await call('/api/client/session', { token: exporter.token });
        expect(after.status).toBe(401);
        const asExporter = await importPackage(exporter.token, zip);
        expect(asExporter.status).toBe(401);
        expect(await ratingOf(insp)).toBeUndefined();

        const res = await importPackage(manager.token, zip);
        expect(res.status, await res.clone().text()).toBe(200);
        expect(await ratingOf(insp)).toBe('RR');
    });

    // ── 3. The same package twice ─────────────────────────────────────────────

    it('importing the same package twice changes nothing the second time', async () => {
        const insp = await createInspection(author);
        const zip = buildPackage(pkg({ exportedBy: author.id }, insp, {
            outbox: [
                { idempotencyKey: fresh('k'), op: 'inspection.update', payload: { id: insp.id, propertyAddress: '12 Twice Street, Town' } },
                { idempotencyKey: fresh('k'), op: 'inspection.complete', payload: { id: insp.id } },
            ],
        }));

        const first = await importPackage(manager.token, zip);
        expect(first.status, await first.clone().text()).toBe(200);
        const keysAfterFirst = await photoKeys(insp);
        const inspectionsAfterFirst = await inspectionCount();
        const snapshotsAfterFirst = await snapshotCount(insp);
        expect(keysAfterFirst).toHaveLength(1);
        expect(snapshotsAfterFirst).toBe(1);

        const second = await importPackage(manager.token, zip);
        expect(second.status, await second.clone().text()).toBe(200);
        expect((await body(second)).data).toEqual({
            inspections: 1, photos: 1, outbox: { applied: 0, skipped: 2, failed: [] }, yjs: { changed: 0, unchanged: 1 },
        });
        expect(await photoKeys(insp)).toEqual(keysAfterFirst);
        expect(await inspectionCount()).toBe(inspectionsAfterFirst);
        expect(await snapshotCount(insp)).toBe(snapshotsAfterFirst);
        expect(await ratingOf(insp)).toBe('RR');
        const photos = (await projection(insp))[KEY]?.photos as PhotoEntry[] | undefined;
        expect(photos).toHaveLength(1);
    });

    it('does not create a second inspection when a create is replayed after its idempotency record is gone', async () => {
        const id = fresh('insp-replay');
        const spec: PackageSpec = {
            tenantId: TENANT, exportedBy: author.id, inspections: [{ id, reportId: 'device-report' }],
            yjs: { [id]: deviceState('RR') },
            outbox: [{ idempotencyKey: fresh('k'), op: 'inspection.create', payload: { id, propertyAddress: '3 Replay Lane, Town', templateId: TEMPLATE } }],
        };
        const zip = buildPackage(spec);
        const first = await importPackage(manager.token, zip);
        expect(first.status, await first.clone().text()).toBe(200);
        const count = await inspectionCount();
        // The 24 hour record expires; the client id is what still holds the line.
        await b.DB.prepare('DELETE FROM idempotency_keys WHERE tenant_id = ?').bind(TENANT).run();
        const second = await importPackage(manager.token, zip);
        expect(second.status, await second.clone().text()).toBe(200);
        expect((await body(second)).data?.outbox).toEqual({ applied: 0, skipped: 1, failed: [] });
        expect(await inspectionCount()).toBe(count);
    });

    // ── 4. Another workspace's package ────────────────────────────────────────

    it('refuses a package from another workspace and changes nothing (positive control: the same package for this workspace)', async () => {
        const insp = await createInspection(author);
        const mine = pkg({ exportedBy: author.id }, insp);
        const foreign = buildPackage({ ...mine, tenantId: OTHER_TENANT });

        const refused = await importPackage(manager.token, foreign);
        expect(refused.status).toBe(403);
        expect(await ratingOf(insp)).toBeUndefined();
        expect(await photoKeys(insp)).toEqual([]);
        expect(await snapshotCount(insp)).toBe(0);

        const ok = await importPackage(manager.token, buildPackage(mine));
        expect(ok.status, await ok.clone().text()).toBe(200);
        expect(await ratingOf(insp)).toBe('RR');
    });

    // ── 5. All-or-nothing authorization ───────────────────────────────────────

    it('refuses the whole package when the importer cannot edit one inspection in it', async () => {
        const importer = await addMember('inspector');
        const other = await addMember('inspector');
        const mine = await createInspection(importer, '10 Mine Road, Town');
        const theirs = await createInspection(other, '20 Theirs Road, Town');

        const both = buildPackage({
            tenantId: TENANT, exportedBy: author.id,
            inspections: [{ id: mine.id, reportId: mine.reportId }, { id: theirs.id, reportId: theirs.reportId }],
            yjs: { [mine.id]: deviceState('RR', 'p-mine'), [theirs.id]: deviceState('RR', 'p-theirs') },
            media: [
                { pendingId: 'p-mine', inspectionId: mine.id, contentType: 'image/jpeg' },
                { pendingId: 'p-theirs', inspectionId: theirs.id, contentType: 'image/jpeg' },
            ],
            outbox: [{ idempotencyKey: fresh('k'), op: 'inspection.update', payload: { id: mine.id, propertyAddress: '11 Should Not Apply, Town' } }],
        });
        const refused = await importPackage(importer.token, both);
        expect(refused.status, await refused.clone().text()).toBe(403);
        // The refusal names the inspection, so a client can take it out of the package and send the rest.
        expect(((await refused.json()) as { error: { details: { inspectionId: string } } }).error.details).toEqual({ inspectionId: theirs.id });
        // Nothing moved, for the inspection the importer COULD edit as well.
        expect(await addressOf(mine.id)).toBe('10 Mine Road, Town');
        expect(await ratingOf(mine)).toBeUndefined();
        expect(await photoKeys(mine)).toEqual([]);
        expect(await ratingOf(theirs)).toBeUndefined();
        expect(await photoKeys(theirs)).toEqual([]);

        // Control: a package for only the importer's own inspection imports.
        const onlyMine = buildPackage({
            tenantId: TENANT, exportedBy: author.id,
            inspections: [{ id: mine.id, reportId: mine.reportId }],
            yjs: { [mine.id]: deviceState('RR') },
            outbox: [{ idempotencyKey: fresh('k'), op: 'inspection.update', payload: { id: mine.id, propertyAddress: '11 Should Apply Now, Town' } }],
        });
        const ok = await importPackage(importer.token, onlyMine);
        expect(ok.status, await ok.clone().text()).toBe(200);
        expect(await addressOf(mine.id)).toBe('11 Should Apply Now, Town');
    });

    // ── 6. Claims that name things outside the manifest ───────────────────────

    it('refuses a media index that names an inspection outside the manifest (positive control: the honest index)', async () => {
        const insp = await createInspection(author);
        const outside = await createInspection(author);
        const tampered = buildPackage(pkg({ exportedBy: author.id }, insp, {
            media: [{ pendingId: 'pend-1', inspectionId: outside.id, contentType: 'image/jpeg' }],
        }));
        const refused = await importPackage(manager.token, tampered);
        expect(refused.status, await refused.clone().text()).toBe(400);
        expect(await photoKeys(outside)).toEqual([]);
        expect(await photoKeys(insp)).toEqual([]);
        expect(await ratingOf(insp)).toBeUndefined();

        const ok = await importPackage(manager.token, buildPackage(pkg({ exportedBy: author.id }, insp)));
        expect(ok.status, await ok.clone().text()).toBe(200);
    });

    it('refuses a queued write that targets an inspection outside the manifest (positive control: in the manifest)', async () => {
        const insp = await createInspection(author);
        const outside = await createInspection(author, '30 Outside Road, Town');
        const borrow = { idempotencyKey: fresh('k'), op: 'inspection.update', payload: { id: outside.id, propertyAddress: '31 Borrowed Road, Town' } };
        const refused = await importPackage(manager.token, buildPackage(pkg({ exportedBy: author.id }, insp, { outbox: [borrow] })));
        expect(refused.status, await refused.clone().text()).toBe(400);
        expect(await addressOf(outside.id)).toBe('30 Outside Road, Town');
        expect(await ratingOf(insp)).toBeUndefined();

        const inside = { ...borrow, payload: { id: insp.id, propertyAddress: '32 Inside Road, Town' } };
        const ok = await importPackage(manager.token, buildPackage(pkg({ exportedBy: author.id }, insp, { outbox: [inside] })));
        expect(ok.status, await ok.clone().text()).toBe(200);
        expect(await addressOf(insp.id)).toBe('32 Inside Road, Town');
        expect(await addressOf(outside.id)).toBe('30 Outside Road, Town');
    });

    it('refuses an operation outside the registry, a manifest for a different report, and a malformed archive', async () => {
        const insp = await createInspection(author);
        const base = pkg({ exportedBy: author.id }, insp);

        const badOp = await importPackage(manager.token, buildPackage({
            ...base, outbox: [{ idempotencyKey: fresh('k'), op: 'inspection.delete', payload: { id: insp.id } }],
        }));
        expect(badOp.status).toBe(400);

        const wrongReport = await importPackage(manager.token, buildPackage({ ...base, inspections: [{ id: insp.id, reportId: 'some-other-report' }] }));
        expect(wrongReport.status).toBe(400);

        const notZip = await importPackage(manager.token, new TextEncoder().encode('definitely not a zip archive'));
        expect(notZip.status).toBe(400);

        const traversal = await importPackage(manager.token, buildPackage({ ...base, extra: { '../escape.json': new Uint8Array([1]) } }));
        expect(traversal.status).toBe(400);

        expect(await ratingOf(insp)).toBeUndefined();
        const ok = await importPackage(manager.token, buildPackage(base));
        expect(ok.status, await ok.clone().text()).toBe(200);
    });

    // ── 7. A queued write that fails ──────────────────────────────────────────

    it('imports the results and photos even when a queued write is refused, and reports the entry', async () => {
        const insp = await createInspection(author);
        const goodKey = fresh('k');
        const badKey = fresh('k');
        const good = { idempotencyKey: goodKey, op: 'inspection.update', payload: { id: insp.id, propertyAddress: '40 Applied Road, Town' } };
        const bad = { idempotencyKey: badKey, op: 'inspection.update', payload: { id: insp.id, status: 'not-a-status' } };
        const zip = buildPackage(pkg({ exportedBy: author.id }, insp, { outbox: [good, bad] }));

        const res = await importPackage(manager.token, zip);
        expect(res.status, await res.clone().text()).toBe(200);
        expect((await body(res)).data).toEqual({
            inspections: 1, photos: 1, yjs: { changed: 1, unchanged: 0 },
            outbox: { applied: 1, skipped: 0, failed: [{ idempotencyKey: badKey, op: 'inspection.update', inspectionId: insp.id, status: 400 }] },
        });
        // The inspector's field work is in, the good write applied, the refused one changed nothing.
        expect(await ratingOf(insp)).toBe('RR');
        expect(await photoKeys(insp)).toHaveLength(1);
        expect(await addressOf(insp.id)).toBe('40 Applied Road, Town');
        const audit = (await auditRows()).filter((r) => (r.metadata ?? '').includes(insp.id) || (r.metadata ?? '').includes(author.id));
        expect(audit.map((r) => (JSON.parse(r.metadata ?? '{}') as { failed?: number }).failed)).toContain(1);

        // Importing the package again: the refused entry is still reported, everything else is a repeat.
        const again = await importPackage(manager.token, zip);
        expect(again.status, await again.clone().text()).toBe(200);
        expect((await body(again)).data).toEqual({
            inspections: 1, photos: 1, yjs: { changed: 0, unchanged: 1 },
            outbox: { applied: 0, skipped: 1, failed: [{ idempotencyKey: badKey, op: 'inspection.update', inspectionId: insp.id, status: 400 }] },
        });

        // The device fixes the entry (same key, valid payload) and sends again: it applies now.
        const fixed = { ...bad, payload: { id: insp.id, propertyAddress: '41 Second Road, Town' } };
        const ok = await importPackage(manager.token, buildPackage(pkg({ exportedBy: author.id }, insp, { outbox: [good, fixed] })));
        expect(ok.status, await ok.clone().text()).toBe(200);
        expect((await body(ok)).data?.outbox).toEqual({ applied: 1, skipped: 1, failed: [] });
        expect(await addressOf(insp.id)).toBe('41 Second Road, Town');
    });

    it('reports an update refused because the inspection was cancelled, and still imports its results', async () => {
        const insp = await createInspection(author);
        const cancel = await call(`/api/inspections/${insp.id}/cancel`, {
            method: 'POST', token: manager.token, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'other' }),
        });
        expect(cancel.status, await cancel.clone().text()).toBe(200);
        const key = fresh('k');
        const queued = { idempotencyKey: key, op: 'inspection.update', payload: { id: insp.id, status: 'confirmed' } };
        const res = await importPackage(manager.token, buildPackage(pkg({ exportedBy: author.id }, insp, { outbox: [queued] })));
        expect(res.status, await res.clone().text()).toBe(200);
        expect((await body(res)).data?.outbox.failed).toEqual([{ idempotencyKey: key, op: 'inspection.update', inspectionId: insp.id, status: 400 }]);
        expect(await ratingOf(insp)).toBe('RR');
        expect(await photoKeys(insp)).toHaveLength(1);
    });

    it('stops the whole request on a server error in a queued write, and a retry completes it', async () => {
        const insp = await createInspection(author);
        const key = fresh('k');
        const zip = buildPackage(pkg({ exportedBy: author.id }, insp, {
            outbox: [{ idempotencyKey: key, op: 'inspection.update', payload: { id: insp.id, propertyAddress: '42 Retry Road, Town' } }],
        }));
        // The first lookup is the import's own authorization check; the second is the PATCH route's.
        // Only that one is made to fail, so the failure lands inside the queued write.
        let failing = false;
        let lookups = 0;
        const real = InspectionService.prototype.getInspection;
        const spy = vi.spyOn(InspectionService.prototype, 'getInspection').mockImplementation(function (this: InspectionService, id: string, tenantId: string) {
            if (id === insp.id && failing && ++lookups >= 2) return Promise.reject(new Error('simulated outage'));
            return real.call(this, id, tenantId);
        });
        try {
            failing = true;
            lookups = 0;
            const res = await importPackage(manager.token, zip);
            expect(res.status, await res.clone().text()).toBe(503);
            expect(await addressOf(insp.id)).toBe('1 Original Road, Anytown');
            expect(await recordedCount(key)).toBe(0);

            failing = false;
            const retry = await importPackage(manager.token, zip);
            expect(retry.status, await retry.clone().text()).toBe(200);
            expect((await body(retry)).data?.outbox).toEqual({ applied: 1, skipped: 0, failed: [] });
            expect(await addressOf(insp.id)).toBe('42 Retry Road, Town');
        } finally {
            spy.mockRestore();
        }
    });

    // ── 7b. A repeat after the 24 hour ledger is gone ─────────────────────────

    it('does not put an old queued update over a newer edit when the same package is imported after the ledger expired', async () => {
        const insp = await createInspection(author);
        const updateKey = fresh('k');
        const completeKey = fresh('k');
        const zip = buildPackage(pkg({ exportedBy: author.id }, insp, {
            outbox: [
                { idempotencyKey: updateKey, op: 'inspection.update', payload: { id: insp.id, propertyAddress: '12 Old St' } },
                { idempotencyKey: completeKey, op: 'inspection.complete', payload: { id: insp.id } },
            ],
        }));
        const first = await importPackage(manager.token, zip);
        expect(first.status, await first.clone().text()).toBe(200);
        expect((await body(first)).data?.outbox).toEqual({ applied: 2, skipped: 0, failed: [] });
        expect(await addressOf(insp.id)).toBe('12 Old St');

        // Someone else edits the address, and the 24 hour ledger forgets everything.
        await b.DB.prepare('UPDATE inspections SET property_address = ? WHERE id = ?').bind('12 Old Street', insp.id).run();
        await b.DB.prepare('DELETE FROM idempotency_keys').run();

        const again = await importPackage(manager.token, zip);
        expect(again.status, await again.clone().text()).toBe(200);
        expect((await body(again)).data?.outbox).toEqual({ applied: 0, skipped: 2, failed: [] });
        expect(await addressOf(insp.id), 'the later edit must survive a repeat import').toBe('12 Old Street');

        // Control: an entry with a NEW key in the same shape of package still applies.
        const newer = { idempotencyKey: fresh('k'), op: 'inspection.update', payload: { id: insp.id, propertyAddress: '13 New Avenue' } };
        const next = await importPackage(manager.token, buildPackage(pkg({ exportedBy: author.id }, insp, { outbox: [newer] })));
        expect(next.status, await next.clone().text()).toBe(200);
        expect((await body(next)).data?.outbox).toEqual({ applied: 1, skipped: 0, failed: [] });
        expect(await addressOf(insp.id)).toBe('13 New Avenue');

        // The record names the tenant, the operation, the inspection and the importer.
        const row = await b.DB.prepare('SELECT tenant_id, op, inspection_id, applied_by, applied_at FROM offline_import_applied WHERE idempotency_key = ?')
            .bind(updateKey).first<{ tenant_id: string; op: string; inspection_id: string; applied_by: string; applied_at: number }>();
        expect(row).toMatchObject({ tenant_id: TENANT, op: 'inspection.update', inspection_id: insp.id, applied_by: manager.id });
        expect(row!.applied_at).toBeGreaterThan(Date.now() - 60_000);
    });

    it('scopes the applied record to the workspace: another workspace has the same key and this one is not skipped (positive control: its own record is)', async () => {
        const insp = await createInspection(author);
        const sharedKey = fresh('k');
        const ownKey = fresh('k');
        const now = Date.now();
        const insert = (tenant: string, key: string) => b.DB.prepare(
            'INSERT INTO offline_import_applied (tenant_id, idempotency_key, op, inspection_id, applied_at, applied_by) VALUES (?, ?, ?, ?, ?, ?)',
        ).bind(tenant, key, 'inspection.update', insp.id, now, 'someone').run();
        await insert(OTHER_TENANT, sharedKey);
        await insert(TENANT, ownKey);
        const zip = buildPackage(pkg({ exportedBy: author.id }, insp, {
            outbox: [
                { idempotencyKey: sharedKey, op: 'inspection.update', payload: { id: insp.id, propertyAddress: '60 Shared Key Road' } },
                { idempotencyKey: ownKey, op: 'inspection.update', payload: { id: insp.id, propertyAddress: '61 Own Key Road' } },
            ],
        }));
        const res = await importPackage(manager.token, zip);
        expect(res.status, await res.clone().text()).toBe(200);
        expect((await body(res)).data?.outbox).toEqual({ applied: 1, skipped: 1, failed: [] });
        expect(await addressOf(insp.id)).toBe('60 Shared Key Road');
    });

    it('keys the applied record by inspection as well: one key recorded for inspection A does not skip a write to inspection B (positive control: A\'s own repeat is skipped)', async () => {
        const a = await createInspection(author);
        const other = await createInspection(author);
        const key = fresh('k');
        await b.DB.prepare(
            'INSERT INTO offline_import_applied (tenant_id, idempotency_key, op, inspection_id, applied_at, applied_by) VALUES (?, ?, ?, ?, ?, ?)',
        ).bind(TENANT, key, 'inspection.update', a.id, Date.now(), 'someone').run();
        const forOther = await importPackage(manager.token, buildPackage(pkg({ exportedBy: author.id }, other, {
            outbox: [{ idempotencyKey: key, op: 'inspection.update', payload: { id: other.id, propertyAddress: '70 Same Key Road' } }],
        })));
        expect(forOther.status, await forOther.clone().text()).toBe(200);
        expect((await body(forOther)).data?.outbox).toEqual({ applied: 1, skipped: 0, failed: [] });
        expect(await addressOf(other.id)).toBe('70 Same Key Road');
        expect(await recordedCount(key)).toBe(2);

        const forA = await importPackage(manager.token, buildPackage(pkg({ exportedBy: author.id }, a, {
            outbox: [{ idempotencyKey: key, op: 'inspection.update', payload: { id: a.id, propertyAddress: '71 Must Not Apply Road' } }],
        })));
        expect(forA.status, await forA.clone().text()).toBe(200);
        expect((await body(forA)).data?.outbox).toEqual({ applied: 0, skipped: 1, failed: [] });
        expect(await addressOf(a.id)).not.toBe('71 Must Not Apply Road');
    });

    it('does not report a deleted inspection for a create that reuses a key another inspection recorded (positive control: the same id is reported)', async () => {
        const key = fresh('k');
        const recordedFor = fresh('insp-gone');
        const id = fresh('insp-newcreate');
        await b.DB.prepare(
            'INSERT INTO offline_import_applied (tenant_id, idempotency_key, op, inspection_id, applied_at, applied_by) VALUES (?, ?, ?, ?, ?, ?)',
        ).bind(TENANT, key, 'inspection.create', recordedFor, Date.now(), 'someone').run();
        const make = (inspectionId: string) => buildPackage({
            tenantId: TENANT, exportedBy: author.id, inspections: [{ id: inspectionId, reportId: 'device-report' }],
            yjs: { [inspectionId]: deviceState('RR') },
            outbox: [{ idempotencyKey: key, op: 'inspection.create', payload: { id: inspectionId, propertyAddress: '72 Reused Key Road, Town', templateId: TEMPLATE } }],
        });
        const revive = await importPackage(manager.token, make(recordedFor));
        expect(revive.status, await revive.clone().text()).toBe(409);
        expect(await revive.text()).toContain('PACKAGE_INSPECTION_DELETED');

        const res = await importPackage(manager.token, make(id));
        expect(res.status, await res.clone().text()).toBe(200);
        expect((await body(res)).data?.outbox).toEqual({ applied: 1, skipped: 0, failed: [] });
        expect(await addressOf(id)).toBe('72 Reused Key Road, Town');
        expect(await recordedCount(key)).toBe(2);
    });

    it('records nothing for a refused write, so the same key applies once the entry is valid', async () => {
        const insp = await createInspection(author);
        const key = fresh('k');
        const refused = await importPackage(manager.token, buildPackage(pkg({ exportedBy: author.id }, insp, {
            outbox: [{ idempotencyKey: key, op: 'inspection.update', payload: { id: insp.id, status: 'not-a-status' } }],
        })));
        expect(refused.status, await refused.clone().text()).toBe(200);
        expect((await body(refused)).data?.outbox.failed).toHaveLength(1);
        expect(await recordedCount(key)).toBe(0);

        const fixed = await importPackage(manager.token, buildPackage(pkg({ exportedBy: author.id }, insp, {
            outbox: [{ idempotencyKey: key, op: 'inspection.update', payload: { id: insp.id, propertyAddress: '62 Fixed Road' } }],
        })));
        expect((await body(fixed)).data?.outbox).toEqual({ applied: 1, skipped: 0, failed: [] });
        expect(await recordedCount(key)).toBe(1);
    });

    // ── 7c. A create is recorded too ──────────────────────────────────────────

    it('refuses to bring back an inspection that an earlier import created and an admin then deleted (positive control: the replay before the delete)', async () => {
        const id = fresh('insp-revive');
        const createKey = fresh('k');
        const spec: PackageSpec = {
            tenantId: TENANT, exportedBy: author.id, inspections: [{ id, reportId: 'device-report' }],
            yjs: { [id]: deviceState('RR', 'pend-1') },
            media: [{ pendingId: 'pend-1', inspectionId: id, contentType: 'image/jpeg' }],
            outbox: [{ idempotencyKey: createKey, op: 'inspection.create', payload: { id, propertyAddress: '8 Revive Road, Town', templateId: TEMPLATE } }],
        };
        const zip = buildPackage(spec);
        const first = await importPackage(manager.token, zip);
        expect(first.status, await first.clone().text()).toBe(200);
        expect((await body(first)).data?.outbox).toEqual({ applied: 1, skipped: 0, failed: [] });
        expect(await recordedCount(createKey)).toBe(1);

        // Control: while the inspection exists, a repeat succeeds and everything is skipped.
        const replay = await importPackage(manager.token, zip);
        expect(replay.status, await replay.clone().text()).toBe(200);
        expect((await body(replay)).data).toMatchObject({ outbox: { applied: 0, skipped: 1, failed: [] }, yjs: { changed: 0, unchanged: 1 } });

        const reportRow = await b.DB.prepare('SELECT id FROM reports WHERE inspection_id = ?').bind(id).first<{ id: string }>();
        const insp: Created = { id, reportId: reportRow!.id };
        const snapshotsBefore = await snapshotCount(insp);
        await deleteInspectionCascade(drizzle(b.DB), b.PHOTOS, TENANT, id);
        expect(await addressOf(id)).toBeNull();
        expect(await photoKeys(insp)).toEqual([]);
        const countAfterDelete = await inspectionCount();

        const again = await importPackage(manager.token, zip);
        expect(again.status, await again.clone().text()).toBe(409);
        const text = await again.text();
        expect(text).toContain('PACKAGE_INSPECTION_DELETED');
        expect(text).toContain(id);

        // Nothing was written: no inspection, no photo, no snapshot, no second record.
        expect(await addressOf(id)).toBeNull();
        expect(await inspectionCount()).toBe(countAfterDelete);
        expect(await photoKeys(insp)).toEqual([]);
        expect(await snapshotCount(insp)).toBe(snapshotsBefore);
        expect(await recordedCount(createKey)).toBe(1);
    });

    it('stops persisting a document whose inspection was hard-deleted: no unhandled error, no re-armed alarm, no row written (positive control: the persist before the delete)', async () => {
        const insp = await createInspection(author);
        const res = await importPackage(manager.token, buildPackage(pkg({ exportedBy: author.id }, insp)));
        expect(res.status, await res.clone().text()).toBe(200);
        const resultsRows = async (): Promise<number> => (await b.DB.prepare('SELECT count(*) AS n FROM inspection_results WHERE tenant_id = ? AND inspection_id = ?')
            .bind(TENANT, insp.id).first<{ n: number }>())?.n ?? 0;

        // Control: with the inspection alive, the pending alarm flushes the edit into D1.
        await runInDurableObject(stubFor(insp), async (instance: InspectionDocDO) => {
            await (instance as unknown as { alarm(): Promise<void> }).alarm();
        });
        expect(await resultsRows()).toBe(1);

        // An edit is pending when the inspection is deleted: the debounce timer and the storage alarm are both armed.
        await runInDurableObject(stubFor(insp), async (instance: InspectionDocDO, state) => {
            const doc = (instance as unknown as { doc: Y.Doc }).doc;
            applyItemPatch(doc, KEY, 'rating', 'SAT');
            expect(await state.storage.getAlarm()).not.toBeNull();
        });
        await deleteInspectionCascade(drizzle(b.DB), b.PHOTOS, TENANT, insp.id);
        expect(await resultsRows()).toBe(0);

        // The alarm firing must neither throw nor write, and must not schedule itself again.
        await runInDurableObject(stubFor(insp), async (instance: InspectionDocDO, state) => {
            await expect((instance as unknown as { alarm(): Promise<void> }).alarm()).resolves.toBeUndefined();
            expect(await state.storage.getAlarm()).toBeNull();
            const timers = instance as unknown as { persistTimer: ReturnType<typeof setTimeout> | null };
            expect(timers.persistTimer).toBeNull();
            // The deleted inspection's document is not kept in the object's storage either.
            expect([...(await state.storage.list()).keys()]).toEqual([]);
        });
        expect(await resultsRows()).toBe(0);
    });

    it.each(['photo', 'yjs', 'outbox'] as const)('refuses the whole package when a %s entry holds more bytes than its directory declares, before any write (positive control: the accurate package)', async (kind) => {
        const id = fresh('insp-lying');
        const key = fresh('k');
        const spec: PackageSpec = {
            tenantId: TENANT, exportedBy: author.id, inspections: [{ id, reportId: 'device-report' }],
            yjs: { [id]: deviceState('RR', 'pend-1') },
            media: [{ pendingId: 'pend-1', inspectionId: id, contentType: 'image/jpeg', bytes: Uint8Array.from({ length: 1000 }, (_, i) => (i * 7) & 255) }],
            outbox: [{ idempotencyKey: key, op: 'inspection.create', payload: { id, propertyAddress: '3 Lying Lane, Town', templateId: TEMPLATE } }],
        };
        const entry = { photo: 'media/pend-1.jpg', yjs: `yjs/${id}.bin`, outbox: 'outbox.json' }[kind];
        const honest = buildPackage(spec);
        const lying = declareEntrySize(honest, entry, 10);

        const refused = await importPackage(manager.token, lying);
        expect(refused.status, await refused.clone().text()).toBe(400);
        expect(await refused.text()).toContain(entry);
        // Nothing was written: no inspection, no record of the create, no photo anywhere in the workspace's store for it.
        expect(await addressOf(id)).toBeNull();
        expect(await recordedCount(key)).toBe(0);
        expect((await b.PHOTOS.list({ prefix: `${TENANT}/inspections/${id}/` })).objects).toEqual([]);

        const accepted = await importPackage(manager.token, honest);
        expect(accepted.status, await accepted.clone().text()).toBe(200);
        expect(await addressOf(id)).toBe('3 Lying Lane, Town');
    });

    // ── Package age and the retention of applied records ───────────────────────

    const DAY = 24 * 60 * 60 * 1000;
    const exportedDaysAgo = (days: number): string => new Date(Date.now() - days * DAY).toISOString();

    it('refuses a package exported more than the maximum age ago, before any write (positive control: just inside the age)', async () => {
        const id = fresh('insp-aged');
        const key = fresh('k');
        const make = (days: number) => buildPackage({
            tenantId: TENANT, exportedBy: author.id, inspections: [{ id, reportId: 'device-report' }],
            yjs: { [id]: deviceState('RR') }, manifest: { exportedAt: exportedDaysAgo(days) },
            outbox: [{ idempotencyKey: key, op: 'inspection.create', payload: { id, propertyAddress: '6 Aged Avenue, Town', templateId: TEMPLATE } }],
        });
        const expired = await importPackage(manager.token, make(PACKAGE_MAX_AGE_DAYS + 1));
        expect(expired.status, await expired.clone().text()).toBe(422);
        const text = await expired.text();
        expect(text).toContain('PACKAGE_EXPIRED');
        expect(text).toContain(String(PACKAGE_MAX_AGE_DAYS));
        expect(await addressOf(id)).toBeNull();
        expect(await recordedCount(key)).toBe(0);

        const inside = await importPackage(manager.token, make(PACKAGE_MAX_AGE_DAYS - 1));
        expect(inside.status, await inside.clone().text()).toBe(200);
        expect(await addressOf(id)).toBe('6 Aged Avenue, Town');
    });

    it('sweeps old applied records of this workspace after an import: keeps recent ones and those of other workspaces (positive control: the old record is there first)', async () => {
        const old = fresh('k-old');
        const recent = fresh('k-recent');
        const foreign = fresh('k-foreign');
        const insert = (tenant: string, key: string, daysAgo: number) => b.DB.prepare(
            'INSERT INTO offline_import_applied (tenant_id, idempotency_key, op, inspection_id, applied_at, applied_by) VALUES (?, ?, ?, ?, ?, ?)',
        ).bind(tenant, key, 'inspection.update', 'gone-inspection', Date.now() - daysAgo * DAY, 'someone').run();
        await insert(TENANT, old, APPLIED_RECORD_RETENTION_DAYS + 5);
        await insert(TENANT, recent, APPLIED_RECORD_RETENTION_DAYS - 5);
        await insert(OTHER_TENANT, foreign, APPLIED_RECORD_RETENTION_DAYS + 5);
        const countFor = async (tenant: string, key: string): Promise<number> =>
            (await b.DB.prepare('SELECT count(*) AS n FROM offline_import_applied WHERE tenant_id = ? AND idempotency_key = ?').bind(tenant, key).first<{ n: number }>())?.n ?? 0;
        expect([await countFor(TENANT, old), await countFor(TENANT, recent), await countFor(OTHER_TENANT, foreign)]).toEqual([1, 1, 1]);

        const insp = await createInspection(author);
        const res = await importPackage(manager.token, buildPackage(pkg({ exportedBy: author.id }, insp)));
        expect(res.status, await res.clone().text()).toBe(200);

        expect(await countFor(TENANT, old)).toBe(0);
        expect(await countFor(TENANT, recent)).toBe(1);
        expect(await countFor(OTHER_TENANT, foreign)).toBe(1);
    });

    it('sweeps a bounded batch per import, so a large backlog is cleared over several imports', async () => {
        const backlog = APPLIED_RECORD_SWEEP_BATCH + 5;
        await b.DB.batch(Array.from({ length: backlog }, (_, i) => b.DB.prepare(
            'INSERT INTO offline_import_applied (tenant_id, idempotency_key, op, inspection_id, applied_at, applied_by) VALUES (?, ?, ?, ?, ?, ?)',
        ).bind(TENANT, `backlog-${i}`, 'inspection.update', 'gone-inspection', Date.now() - (APPLIED_RECORD_RETENTION_DAYS + 30) * DAY, 'someone')));
        const left = async (): Promise<number> =>
            (await b.DB.prepare("SELECT count(*) AS n FROM offline_import_applied WHERE tenant_id = ? AND idempotency_key LIKE 'backlog-%'").bind(TENANT).first<{ n: number }>())?.n ?? 0;
        expect(await left()).toBe(backlog);
        const importOnce = async (): Promise<void> => {
            const insp = await createInspection(author);
            const res = await importPackage(manager.token, buildPackage(pkg({ exportedBy: author.id }, insp)));
            expect(res.status, await res.clone().text()).toBe(200);
        };
        await importOnce();
        expect(await left()).toBe(5);
        await importOnce();
        expect(await left()).toBe(0);
    });

    it('records nothing for a create the server refused, so the same key creates once the entry is valid', async () => {
        const id = fresh('insp-badcreate');
        const key = fresh('k');
        const make = (templateId: string) => buildPackage({
            tenantId: TENANT, exportedBy: author.id, inspections: [{ id, reportId: 'device-report' }],
            yjs: { [id]: deviceState('RR') },
            outbox: [{ idempotencyKey: key, op: 'inspection.create', payload: { id, propertyAddress: '9 Refused Road, Town', templateId } }],
        });
        const refused = await importPackage(manager.token, make('no-such-template'));
        expect(refused.status, await refused.clone().text()).toBeGreaterThanOrEqual(400);
        expect(await addressOf(id)).toBeNull();
        expect(await recordedCount(key)).toBe(0);

        const fixed = await importPackage(manager.token, make(TEMPLATE));
        expect(fixed.status, await fixed.clone().text()).toBe(200);
        expect((await body(fixed)).data?.outbox).toEqual({ applied: 1, skipped: 0, failed: [] });
        expect(await addressOf(id)).toBe('9 Refused Road, Town');
        expect(await recordedCount(key)).toBe(1);
    });

    it('does not treat another workspace\'s create record as this workspace\'s (positive control: its own record is kept)', async () => {
        const id = fresh('insp-xtenant');
        const key = fresh('k');
        await b.DB.prepare(
            'INSERT INTO offline_import_applied (tenant_id, idempotency_key, op, inspection_id, applied_at, applied_by) VALUES (?, ?, ?, ?, ?, ?)',
        ).bind(OTHER_TENANT, key, 'inspection.create', id, Date.now(), 'someone').run();
        const zip = buildPackage({
            tenantId: TENANT, exportedBy: author.id, inspections: [{ id, reportId: 'device-report' }],
            yjs: { [id]: deviceState('RR') },
            outbox: [{ idempotencyKey: key, op: 'inspection.create', payload: { id, propertyAddress: '10 Other Tenant Road, Town', templateId: TEMPLATE } }],
        });
        const res = await importPackage(manager.token, zip);
        expect(res.status, await res.clone().text()).toBe(200);
        expect((await body(res)).data?.outbox).toEqual({ applied: 1, skipped: 0, failed: [] });
        expect(await addressOf(id)).toBe('10 Other Tenant Road, Town');
        expect(await recordedCount(key)).toBe(1);
    });

    it('imports a second, different package sent under the same Idempotency-Key header', async () => {
        const first = await createInspection(author);
        const second = await createInspection(author);
        const headers = { 'Idempotency-Key': fresh('shared-header') };
        const one = await importPackage(manager.token, buildPackage(pkg({ exportedBy: author.id }, first)), { headers });
        expect(one.status, await one.clone().text()).toBe(200);
        const two = await importPackage(manager.token, buildPackage(pkg({ exportedBy: author.id }, second)), { headers });
        expect(two.status, await two.clone().text()).toBe(200);
        expect(two.headers.get('Idempotency-Replayed')).toBeNull();
        expect(await ratingOf(second), 'the second package must be imported, not answered from the first').toBe('RR');
    });

    // ── 8. Request framing ────────────────────────────────────────────────────

    it('requires a Content-Length (411) and refuses an oversized declaration (413) without reading it', async () => {
        const insp = await createInspection(author);
        const zip = buildPackage(pkg({ exportedBy: author.id }, insp));

        const missing = await importPackage(manager.token, zip, { contentLength: null });
        expect(missing.status).toBe(411);
        const huge = await importPackage(manager.token, zip, { contentLength: String(25 * 1024 * 1024) });
        expect(huge.status).toBe(413);
        expect(await ratingOf(insp)).toBeUndefined();

        const ok = await importPackage(manager.token, zip);
        expect(ok.status, await ok.clone().text()).toBe(200);
    });

    it('is not blocked by the version rule, while an ordinary route is', async () => {
        const insp = await createInspection(author);
        const old = { 'X-Client-Platform': 'ios', 'X-Client-Version': '1.0.0' };
        const policy = { NATIVE_MIN_VERSION_IOS: '1.2.0' };
        // The queued write inside travels in-process; it must not inherit the old client's headers.
        const zip = buildPackage(pkg({ exportedBy: author.id }, insp, {
            outbox: [{ idempotencyKey: fresh('k'), op: 'inspection.update', payload: { id: insp.id, propertyAddress: '50 Old App Road, Town' } }],
        }));

        const blocked = await call('/api/inspections', { token: manager.token, headers: old, env: policy });
        expect(blocked.status).toBe(426);

        const res = await importPackage(manager.token, zip, { headers: old, env: policy });
        expect(res.status, await res.clone().text()).toBe(200);
        expect(res.headers.get('X-Client-Upgrade')).toBe('required');
        expect(await addressOf(insp.id)).toBe('50 Old App Road, Town');
    });

    it('refuses the import when native clients are switched off for a native token', async () => {
        const insp = await createInspection(author);
        const zip = buildPackage(pkg({ exportedBy: author.id }, insp));
        const off = await importPackage(manager.token, zip, { env: { NATIVE_CLIENT_ENABLED: 'false' } });
        expect(off.status).toBe(401);
        expect(await ratingOf(insp)).toBeUndefined();
        const on = await importPackage(manager.token, zip);
        expect(on.status, await on.clone().text()).toBe(200);
    });

    // ── 9. The results object loses an update ────────────────────────────────

    it('answers 503 when the document cannot persist, and a retry after the object is evicted applies it', async () => {
        const insp = await createInspection(author);
        const zip = buildPackage(pkg({ exportedBy: author.id }, insp));

        await runInDurableObject(stubFor(insp), (instance: InspectionDocDO) => {
            (instance as unknown as { persist: () => Promise<void> }).persist = () => Promise.reject(new Error('d1 unavailable'));
        });
        const failed = await importPackage(manager.token, zip);
        expect(failed.status, await failed.clone().text()).toBe(503);

        // The object is evicted before anything durable holds the update.
        await runInDurableObject(stubFor(insp), (_instance, state) => {
            try { state.abort('simulated eviction'); } catch { /* the abort surfaces as an error to the caller */ }
        }).catch(() => undefined);
        expect(await ratingOf(insp), 'a rebuilt object must not still hold the unpersisted update').toBeUndefined();

        const retry = await importPackage(manager.token, zip);
        expect(retry.status, await retry.clone().text()).toBe(200);
        expect((await body(retry)).data?.yjs).toEqual({ changed: 1, unchanged: 0 });
        expect(await ratingOf(insp)).toBe('RR');
    });

    // ── 10. Round-two review findings ─────────────────────────────────────────

    it('refuses an entry that declares 10 bytes and carries a compressed stream far larger, as 400 before any write (positive control: the honest package)', async () => {
        const id = fresh('insp-bomb');
        const key = fresh('k');
        const create = { idempotencyKey: key, op: 'inspection.create', payload: { id, propertyAddress: '8 Bomb Lane, Town', templateId: TEMPLATE } };
        const honest = buildPackage({ tenantId: TENANT, exportedBy: author.id, inspections: [{ id, reportId: 'device-report' }], yjs: { [id]: new Uint8Array(16 * 1024 * 1024) }, outbox: [create] });
        const bomb = declareEntrySize(honest, `yjs/${id}.bin`, 10);
        expect(bomb.byteLength, 'the package is small on the wire').toBeLessThan(200 * 1024);

        const started = performance.now();
        const refused = await importPackage(manager.token, bomb);
        const elapsed = performance.now() - started;
        expect(refused.status, await refused.clone().text()).toBe(400);
        expect(await refused.text()).toContain('compressed data');
        expect(elapsed, 'refused from the directory, without inflating 16 MiB').toBeLessThan(2000);
        expect(await addressOf(id)).toBeNull();
        expect(await recordedCount(key)).toBe(0);
        // Control: the same entry under a size an honest encoder could have produced from it is not refused for this reason.
        // (It fails later, as a bad Yjs update, which is a different refusal.)
        const lying = declareEntrySize(honest, `yjs/${id}.bin`, 60_000);
        const later = await importPackage(manager.token, lying);
        expect(await later.text()).not.toContain('compressed data');
    });

    it('imports more inspections than one D1 statement can bind: 120 with NATIVE_IMPORT_MAX_INSPECTIONS=150 (positive control: the same package at the default limit is refused with 422)', async () => {
        const ids = Array.from({ length: 120 }, () => fresh('insp-many'));
        const spec: PackageSpec = {
            tenantId: TENANT, exportedBy: author.id,
            inspections: ids.map((id) => ({ id, reportId: 'device-report' })),
            yjs: Object.fromEntries(ids.map((id) => [id, deviceState('SAT')])),
            outbox: ids.map((id) => ({ idempotencyKey: fresh('k'), op: 'inspection.create', payload: { id, propertyAddress: `${id} Road, Town`, templateId: TEMPLATE } })),
        };
        const zip = buildPackage(spec);
        const defaults = await importPackage(manager.token, zip);
        expect(defaults.status).toBe(422);

        const before = await inspectionCount();
        const res = await importPackage(manager.token, zip, { env: { NATIVE_IMPORT_MAX_INSPECTIONS: '150', NATIVE_IMPORT_MAX_OUTBOX: '150' } });
        expect(res.status, await res.clone().text()).toBe(200);
        expect((await body(res)).data).toMatchObject({ inspections: 120, outbox: { applied: 120, failed: [] }, yjs: { changed: 120 } });
        expect(await inspectionCount()).toBe(before + 120);
    }, 120_000);

    it.each([
        { label: 'more than a day ahead', aheadMs: 2 * 24 * 60 * 60 * 1000, status: 422 },
        { label: 'just inside the allowed skew', aheadMs: 12 * 60 * 60 * 1000, status: 200 },
    ])('a package whose exportedAt is $label answers $status (nothing is written when refused)', async ({ aheadMs, status }) => {
        const id = fresh('insp-future');
        const key = fresh('k');
        const zip = buildPackage({
            tenantId: TENANT, exportedBy: author.id, inspections: [{ id, reportId: 'device-report' }],
            yjs: { [id]: deviceState('RR') }, manifest: { exportedAt: new Date(Date.now() + aheadMs).toISOString() },
            outbox: [{ idempotencyKey: key, op: 'inspection.create', payload: { id, propertyAddress: '9 Future Court, Town', templateId: TEMPLATE } }],
        });
        const res = await importPackage(manager.token, zip);
        expect(res.status, await res.clone().text()).toBe(status);
        if (status === 422) {
            const text = await res.text();
            expect(text).toContain('PACKAGE_FROM_THE_FUTURE');
            expect(text).toContain(String(PACKAGE_MAX_FUTURE_SKEW_DAYS));
            expect(await addressOf(id)).toBeNull();
            expect(await recordedCount(key)).toBe(0);
        } else {
            expect(await addressOf(id)).toBe('9 Future Court, Town');
        }
    });

    it('treats a key held by a request still in flight as transient: the whole import stops and a retry applies it (positive control: a permanent refusal is still only reported)', async () => {
        const insp = await createInspection(author);
        const key = fresh('k');
        const payload = { id: insp.id, propertyAddress: '77 Busy Street, Town' };
        const zip = buildPackage(pkg({ exportedBy: author.id }, insp, { outbox: [{ idempotencyKey: key, op: 'inspection.update', payload }] }));

        // Another request holds this very write's key, as a concurrent duplicate import would.
        const { id, ...patch } = payload;
        const fp = await fingerprint('PATCH', `/api/inspections/${id}`, patch);
        const now = Date.now();
        await b.DB.prepare('INSERT INTO idempotency_keys (tenant_id, key, fingerprint, state, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
            .bind(TENANT, key, fp, 'in_flight', now, now + 60_000).run();

        const busy = await importPackage(manager.token, zip);
        expect(busy.status, await busy.clone().text()).toBe(409);
        expect(await busy.text()).not.toContain('"failed"');
        expect(await addressOf(insp.id)).toBe('1 Original Road, Anytown');
        expect(await recordedCount(key)).toBe(0);

        await b.DB.prepare('DELETE FROM idempotency_keys WHERE tenant_id = ? AND key = ?').bind(TENANT, key).run();
        const retry = await importPackage(manager.token, zip);
        expect(retry.status, await retry.clone().text()).toBe(200);
        expect((await body(retry)).data?.outbox).toEqual({ applied: 1, skipped: 0, failed: [] });
        expect(await addressOf(insp.id)).toBe('77 Busy Street, Town');
    });

    it('does not complete an inspection whose queued update was refused, and still completes another (positive control: the same complete after an accepted update)', async () => {
        const blocked = await createInspection(author);
        const fine = await createInspection(author, '2 Fine Road, Anytown');
        const updateKey = fresh('k');
        const completeKey = fresh('k');
        const otherUpdateKey = fresh('k');
        const otherCompleteKey = fresh('k');
        const zip = buildPackage({
            tenantId: TENANT, exportedBy: author.id,
            inspections: [{ id: blocked.id, reportId: blocked.reportId }, { id: fine.id, reportId: fine.reportId }],
            yjs: { [blocked.id]: deviceState('RR'), [fine.id]: deviceState('RR') },
            outbox: [
                { idempotencyKey: updateKey, op: 'inspection.update', payload: { id: blocked.id, propertyAddress: '' } },
                { idempotencyKey: otherUpdateKey, op: 'inspection.update', payload: { id: fine.id, propertyAddress: '3 Fine Road, Anytown' } },
                { idempotencyKey: completeKey, op: 'inspection.complete', payload: { id: blocked.id } },
                { idempotencyKey: otherCompleteKey, op: 'inspection.complete', payload: { id: fine.id } },
            ],
        });
        const statusOf = async (id: string) => (await b.DB.prepare('SELECT status FROM inspections WHERE id = ?').bind(id).first<{ status: string }>())?.status;
        const before = await statusOf(blocked.id);

        const res = await importPackage(manager.token, zip);
        expect(res.status, await res.clone().text()).toBe(200);
        const data = (await body(res)).data;
        expect(data?.outbox.applied).toBe(2);
        expect(data?.outbox.failed).toEqual([
            { idempotencyKey: updateKey, op: 'inspection.update', inspectionId: blocked.id, status: 400 },
            { idempotencyKey: completeKey, op: 'inspection.complete', inspectionId: blocked.id, status: 424, reason: 'blocked_by_failed_update' },
        ]);
        expect(await statusOf(blocked.id), 'the blocked inspection was not completed').toBe(before);
        expect(await statusOf(fine.id)).not.toBe(before);
        expect(await recordedCount(completeKey)).toBe(0);
        expect(await recordedCount(otherCompleteKey)).toBe(1);
        expect(await addressOf(fine.id)).toBe('3 Fine Road, Anytown');
    });

    // ── Client-chosen ids: replay of a half-written create, and who may see the replay ──

    async function createWithId(by: Member, id: string, extra: Record<string, unknown> = {}): Promise<Response> {
        return call('/api/inspections', {
            method: 'POST', token: by.token, headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id, propertyAddress: '21 Replay Road, Anytown', templateId: TEMPLATE, date: '2026-10-01T10:00:00.000Z', ...extra }),
        });
    }
    const rowCount = async (table: 'reports' | 'inspection_results', id: string): Promise<number> =>
        (await b.DB.prepare(`SELECT count(*) AS n FROM ${table} WHERE tenant_id = ? AND inspection_id = ?`).bind(TENANT, id).first<{ n: number }>())?.n ?? 0;
    const ticketStatus = async (by: Member, id: string): Promise<number> =>
        (await call(`/api/inspections/${id}/collab/ticket`, { method: 'POST', token: by.token })).status;

    it.each([
        ['reports', 'the primary report cannot be written', 404],
        ['inspection_results', 'the results row cannot be written', 200],
    ] as const)('repairs on a retry the inspection a client-id create left half-written when %s fails (%s), without duplicating anything', async (table, _what, openBefore) => {
        const id = fresh('insp-half');
        const trigger = `fail_${table}_${id.replace(/-/g, '_')}`;
        await b.DB.exec(`CREATE TRIGGER ${trigger} BEFORE INSERT ON ${table} WHEN NEW.inspection_id = '${id}' BEGIN SELECT RAISE(ABORT, 'simulated outage'); END;`);
        try {
            const first = await createWithId(author, id);
            expect(first.status, await first.clone().text()).toBeGreaterThanOrEqual(500);
            expect(await addressOf(id), 'the inspection row was written before the failure').not.toBeNull();
            expect(await ticketStatus(manager, id), 'without its primary report an inspection cannot be opened for editing').toBe(openBefore);
            // With no report to name, the results row is written without a report id: the orphan the retry must adopt.
            expect(await rowCount('inspection_results', id)).toBe(table === 'reports' ? 1 : 0);
            expect(await ticketStatus(author, id), 'nor by its assignee, who is on no roster yet').toBe(403);
        } finally {
            await b.DB.exec(`DROP TRIGGER ${trigger}`);
        }

        const retry = await createWithId(author, id);
        expect(retry.status, await retry.clone().text()).toBe(200);
        expect(await rowCount('reports', id)).toBe(1);
        expect(await rowCount('inspection_results', id)).toBe(1);
        const results = await b.DB.prepare('SELECT report_id FROM inspection_results WHERE inspection_id = ?').bind(id).first<{ report_id: string | null }>();
        const report = await b.DB.prepare('SELECT id FROM reports WHERE inspection_id = ?').bind(id).first<{ id: string }>();
        expect(results?.report_id, 'the results row names the primary report').toBe(report?.id);
        expect(await ticketStatus(author, id), 'the repaired inspection opens for its assignee').toBe(200);
        expect(await ticketStatus(manager, id)).toBe(200);

        // Control: a replay of a whole inspection writes nothing more.
        const again = await createWithId(author, id);
        expect(again.status).toBe(200);
        expect(await rowCount('reports', id)).toBe(1);
        expect(await rowCount('inspection_results', id)).toBe(1);
    });

    it('a normal create and its replays leave exactly one report and one results row', async () => {
        const id = fresh('insp-whole');
        expect((await createWithId(author, id)).status).toBe(201);
        expect((await createWithId(author, id)).status).toBe(200);
        expect((await createWithId(manager, id)).status).toBe(200);
        expect(await rowCount('reports', id)).toBe(1);
        expect(await rowCount('inspection_results', id)).toBe(1);
    });

    it('answers a replay with the inspection only to someone who may open it: the assignee and a manager get 200, an unassigned inspector gets 409 ID_CONFLICT and no fields', async () => {
        const id = fresh('insp-private');
        const stranger = await addMember('inspector');
        expect((await createWithId(author, id, { propertyAddress: '404 Private Passage, Town' })).status).toBe(201);

        const mine = await createWithId(author, id);
        expect(mine.status, await mine.clone().text()).toBe(200);
        expect(await mine.text()).toContain('404 Private Passage');
        expect((await createWithId(manager, id)).status).toBe(200);

        const refused = await createWithId(stranger, id);
        expect(refused.status).toBe(409);
        const text = await refused.text();
        expect(text).toContain('ID_CONFLICT');
        expect(text).not.toContain('Private Passage');
        expect(text).not.toContain('propertyAddress');
        // The same answer as for an id that exists in another workspace, so existence is not revealed.
        const otherId = fresh('insp-foreign');
        await b.DB.prepare('INSERT INTO inspections (id, tenant_id, property_address, status, date, created_at) VALUES (?, ?, ?, ?, ?, ?)')
            .bind(otherId, OTHER_TENANT, '1 Elsewhere Way', 'requested', '2026-10-01T10:00:00.000Z', Date.now()).run();
        const foreign = await createWithId(stranger, otherId);
        expect(foreign.status).toBe(409);
        expect(JSON.parse(text)).toEqual(JSON.parse(await foreign.text()));
    });

    it('keeps the results object when a persist fails for a reason other than a deleted inspection (positive control: the retry then writes the row)', async () => {
        const insp = await createInspection(author);
        const res = await importPackage(manager.token, buildPackage(pkg({ exportedBy: author.id }, insp)));
        expect(res.status, await res.clone().text()).toBe(200);
        const resultsRows = async (): Promise<number> => (await b.DB.prepare('SELECT count(*) AS n FROM inspection_results WHERE tenant_id = ? AND inspection_id = ?')
            .bind(TENANT, insp.id).first<{ n: number }>())?.n ?? 0;

        // The row is gone and the insert that would recreate it is refused, but the inspection is alive.
        await b.DB.prepare('DELETE FROM inspection_results WHERE tenant_id = ? AND inspection_id = ?').bind(TENANT, insp.id).run();
        const trigger = `refuse_results_${insp.id.replace(/-/g, '_')}`;
        await b.DB.exec(`CREATE TRIGGER ${trigger} BEFORE INSERT ON inspection_results WHEN NEW.inspection_id = '${insp.id}' BEGIN SELECT RAISE(ABORT, 'simulated outage'); END;`);
        try {
            await runInDurableObject(stubFor(insp), async (instance: InspectionDocDO, state) => {
                applyItemPatch((instance as unknown as { doc: Y.Doc }).doc, KEY, 'rating', 'SAT');
                await expect((instance as unknown as { alarm(): Promise<void> }).alarm()).rejects.toThrow();
                // Not abandoned: the document is still in the object's storage.
                expect([...(await state.storage.list()).keys()].length).toBeGreaterThan(0);
            });
            expect(await resultsRows()).toBe(0);
        } finally {
            await b.DB.exec(`DROP TRIGGER ${trigger}`);
        }

        await runInDurableObject(stubFor(insp), async (instance: InspectionDocDO) => {
            await (instance as unknown as { alarm(): Promise<void> }).alarm();
        });
        expect(await resultsRows(), 'the unchanged object persists once the outage is over').toBe(1);
        expect(await ratingOf(insp)).toBe('SAT');
    });
});
