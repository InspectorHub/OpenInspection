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
import { buildPackage, JPEG_BYTES, type PackageSpec } from '../../unit/helpers/offline-package-fixture';

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
    grants.set(token, { kind: 'native', userId: id, tenantId: TENANT, role, lastUsedAt: 0 });
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

    it('refuses a package that names a missing inspection it does not create (positive control: creating it)', async () => {
        const id = fresh('insp-missing');
        const base: PackageSpec = { tenantId: TENANT, exportedBy: author.id, inspections: [{ id, reportId: 'r' }], yjs: { [id]: deviceState('RR') } };
        const refused = await importPackage(manager.token, buildPackage(base));
        expect(refused.status).toBe(404);
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
        ).bind(tenant, key, 'inspection.update', 'elsewhere', now, 'someone').run();
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
        // The results object debounces a persist after the import. Let that debounce go (timer and alarm)
        // so it cannot write into the inspection while the test deletes it; the delete itself is the subject here.
        await runInDurableObject(stubFor(insp), async (instance: InspectionDocDO, state) => {
            const timers = instance as unknown as { persistTimer: ReturnType<typeof setTimeout> | null };
            if (timers.persistTimer !== null) clearTimeout(timers.persistTimer);
            timers.persistTimer = null;
            await state.storage.deleteAlarm();
        });
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
});
