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
import { describe, it, expect, beforeAll } from 'vitest';
import * as Y from 'yjs';
import app from '../../../server/index';
import { buildKeyring, signJwt } from '../../../server/lib/jwt-keyring';
import { NATIVE_SCOPE, type NativeProps } from '../../../server/lib/auth/native-token';
import { collabDocName } from '../../../server/lib/collab/doc-name';
import { seedResultsDoc, applyItemPatch, pushPendingPhoto, projectResults } from '../../../server/lib/collab/results-doc';
import type { InspectionDocDO } from '../../../server/durable-objects/inspection-doc';
import type { PhotoEntry } from '../../../server/lib/collab/results-doc.types';
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

interface ImportBody { success: boolean; data?: { inspections: number; photos: number; outbox: { applied: number; skipped: number }; yjs: { changed: number; unchanged: number } } }

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
            data: { inspections: 1, photos: 1, outbox: { applied: 2, skipped: 0 }, yjs: { changed: 1, unchanged: 0 } },
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
        expect(JSON.parse(rows[0]!.metadata ?? '{}')).toMatchObject({ exportedBy: author.id, inspections: 1, photos: 1, applied: 2, skipped: 0, changed: 1 });
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
            inspections: 1, photos: 1, outbox: { applied: 0, skipped: 2 }, yjs: { changed: 0, unchanged: 1 },
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
        expect((await body(second)).data?.outbox).toEqual({ applied: 0, skipped: 1 });
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

    it('answers with the failing entry and stays safe to retry', async () => {
        const insp = await createInspection(author);
        const goodKey = fresh('k');
        const badKey = fresh('k');
        const good = { idempotencyKey: goodKey, op: 'inspection.update', payload: { id: insp.id, propertyAddress: '40 Applied Road, Town' } };
        const bad = { idempotencyKey: badKey, op: 'inspection.update', payload: { id: insp.id, status: 'not-a-status' } };

        const refused = await importPackage(manager.token, buildPackage(pkg({ exportedBy: author.id }, insp, { outbox: [good, bad] })));
        expect(refused.status, await refused.clone().text()).toBe(400);
        expect(JSON.stringify(await refused.json())).toContain(badKey);
        // The yjs and photo steps come after the queued writes and did not run.
        expect(await ratingOf(insp)).toBeUndefined();
        expect(await photoKeys(insp)).toEqual([]);
        expect(await addressOf(insp.id)).toBe('40 Applied Road, Town');

        // The device fixes the bad entry and sends the package again: the good one is a repeat.
        const fixed = { ...bad, payload: { id: insp.id, propertyAddress: '41 Second Road, Town' } };
        const ok = await importPackage(manager.token, buildPackage(pkg({ exportedBy: author.id }, insp, { outbox: [good, fixed] })));
        expect(ok.status, await ok.clone().text()).toBe(200);
        expect((await body(ok)).data?.outbox).toEqual({ applied: 1, skipped: 1 });
        expect(await ratingOf(insp)).toBe('RR');
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
