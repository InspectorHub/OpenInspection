/**
 * Importing an offline package on behalf of the signed-in member.
 *
 * Two phases, and the line between them is the point:
 *
 *  1. VALIDATE: reads and checks, writes nothing. The archive is judged from its
 *     directory, the manifest, media index and outbox are parsed, the manifest's
 *     tenant must be the session's tenant, every inspection the package names
 *     must either be one the IMPORTER may edit or be created by the package's own
 *     outbox, and every id the other entries mention must be in the manifest. A
 *     package that fails any of this changes nothing, for every inspection in it.
 *  2. APPLY: queued writes, then photos, then Yjs updates, then pending-photo
 *     resolution. Each step is idempotent, so a request that fails part-way is
 *     retried by sending the same package again.
 *
 * Authority comes from the request alone. The caller's own credentials replay the
 * queued writes (so each one is checked by the route it targets, with the
 * caller's role), and `exportedBy` is only ever written to the audit record. A
 * package exported by a member who has since been removed imports fine when
 * another member with access imports it; the exporter's rights are not consulted
 * because they are not relevant.
 */

import type { Context } from 'hono';
import { and, eq, inArray } from 'drizzle-orm';
import { Errors, type AppError } from '../lib/errors';
import { auditFromContext } from '../lib/audit';
import { inspections } from '../lib/db/schema';
import { getDrizzle } from '../lib/route-helpers';
import { logger } from '../lib/logger';
import { r2Keys } from '../lib/r2-keys';
import { imagesBinding } from '../lib/media/serve-photo';
import { signedPhotoExtFor, storePhotoAtKey } from '../lib/media/store-photo';
import { authorizeCollab, collabStub, type AuthResult } from '../lib/collab/authorize';
import { importUpdateIntoDo } from '../lib/collab/import-route';
import { resolvePendingInDo } from '../lib/collab/resolve-pending-route';
import {
    MANIFEST_ENTRY, MEDIA_INDEX_ENTRY, OUTBOX_ENTRY, listPackage, mediaEntryName, readPackageEntry, yjsEntryName,
} from '../lib/native/offline-zip';
import {
    MediaIndexSchema, OfflinePackageManifestSchema, OutboxSchema,
    type MediaIndex, type OfflinePackageManifest, type OutboxEntry,
} from '../lib/native/offline-package';
import type { HonoConfig } from '../types/hono';

export interface OfflineImportResult {
    inspections: number;
    photos: number;
    outbox: { applied: number; skipped: number };
    yjs: { changed: number; unchanged: number };
}

type CollabIdentity = Extract<AuthResult, { ok: true }>;

interface ImportPlan {
    manifest: OfflinePackageManifest;
    outbox: OutboxEntry[];
    media: MediaIndex;
    /** Declared size of every entry, from the archive directory. */
    entries: ReadonlyMap<string, number>;
    /** Identities for inspections that already exist and that the importer may edit. */
    identities: Map<string, CollabIdentity>;
    /** Inspections the package itself creates. */
    created: Set<string>;
}

function parseEntry(zip: Uint8Array, entries: ReadonlyMap<string, number>, name: string): unknown {
    const size = entries.get(name);
    if (size === undefined) return undefined;
    const bytes = readPackageEntry(zip, name, size);
    if (!bytes) throw Errors.BadRequest(`Package entry ${name} could not be read`);
    try {
        return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes));
    } catch {
        throw Errors.BadRequest(`Package entry ${name} is not valid JSON`);
    }
}

function refusal(auth: Extract<AuthResult, { ok: false }>, inspectionId: string): AppError {
    switch (auth.response.status) {
        case 403: return Errors.Forbidden('You do not have edit access to every inspection in this package');
        case 404: return Errors.NotFound(`Inspection ${inspectionId} cannot be opened for import`);
        case 501: return Errors.ServiceUnavailable('Collaborative editing is unavailable');
        default: return Errors.Unauthorized();
    }
}

/** Phase 1. Reads only. */
async function validate(c: Context<HonoConfig>, zip: Uint8Array): Promise<ImportPlan> {
    const tenantId = c.get('tenantId');
    if (!tenantId) throw Errors.Unauthorized();

    const listing = listPackage(zip);
    if (!listing.ok) throw Errors.BadRequest(`Invalid offline package: ${listing.reason}`);
    const { entries } = listing;

    const rawManifest = parseEntry(zip, entries, MANIFEST_ENTRY);
    const manifestParse = OfflinePackageManifestSchema.safeParse(rawManifest);
    if (!manifestParse.success) throw Errors.BadRequest('Invalid offline package: manifest is not a version 1 manifest');
    const manifest = manifestParse.data;

    // The tenant is the session's. A package from another workspace is refused
    // before its other entries are even parsed.
    if (manifest.tenantId !== tenantId) throw Errors.Forbidden('This package belongs to a different workspace');

    const outboxParse = OutboxSchema.safeParse(parseEntry(zip, entries, OUTBOX_ENTRY) ?? []);
    if (!outboxParse.success) throw Errors.BadRequest('Invalid offline package: outbox is invalid');
    const mediaParse = MediaIndexSchema.safeParse(parseEntry(zip, entries, MEDIA_INDEX_ENTRY) ?? []);
    if (!mediaParse.success) throw Errors.BadRequest('Invalid offline package: media index is invalid');
    const outbox = outboxParse.data;
    const media = mediaParse.data;

    // Every id any entry mentions must be one the manifest declares: the
    // manifest is what gets authorized, so nothing may ride along outside it.
    const declared = new Set(manifest.inspections.map((i) => i.id));
    const bad = (what: string) => Errors.BadRequest(`Invalid offline package: ${what} names an inspection outside the manifest`);
    for (const e of outbox) if (!declared.has(e.payload.id)) throw bad('outbox');
    for (const m of media) if (!declared.has(m.inspectionId)) throw bad('media index');

    const yjsNames = new Set<string>();
    for (const name of entries.keys()) if (name.startsWith('yjs/')) yjsNames.add(name);
    for (const id of declared) {
        if (!yjsNames.delete(yjsEntryName(id))) throw Errors.BadRequest(`Invalid offline package: no Yjs state for inspection ${id}`);
    }
    if (yjsNames.size > 0) throw bad('yjs entries');

    const mediaFiles = new Set<string>();
    for (const name of entries.keys()) if (name.startsWith('media/') && name !== MEDIA_INDEX_ENTRY) mediaFiles.add(name);
    for (const m of media) {
        const ext = signedPhotoExtFor(m.contentType);
        if (!ext || !mediaFiles.delete(mediaEntryName(m.pendingId, ext))) {
            throw Errors.BadRequest(`Invalid offline package: photo ${m.pendingId} is missing or does not match its declared type`);
        }
    }
    if (mediaFiles.size > 0) throw Errors.BadRequest('Invalid offline package: a photo has no media index entry');

    // Which of the named inspections exist in THIS workspace.
    const ids = [...declared];
    const found = await getDrizzle(c).select({ id: inspections.id }).from(inspections)
        .where(and(eq(inspections.tenantId, tenantId), inArray(inspections.id, ids)));
    const existing = new Set(found.map((r) => r.id));

    const creates = new Set(outbox.filter((e) => e.op === 'inspection.create').map((e) => e.payload.id));

    // Authorize every existing inspection as the IMPORTER before anything is written.
    const identities = new Map<string, CollabIdentity>();
    for (const id of existing) {
        const auth = await authorizeCollab(c, id);
        if (!auth.ok) throw refusal(auth, id);
        // The device's document belongs to one report. If the server's primary report
        // for this inspection is a different one, importing would merge two documents.
        // A package that creates the inspection itself carries a placeholder: the device
        // cannot know the id the server gives the report, and a repeat import must pass too.
        const claimed = manifest.inspections.find((i) => i.id === id)?.reportId;
        if (!creates.has(id) && claimed !== auth.reportId) {
            throw Errors.BadRequest(`Invalid offline package: inspection ${id} was exported from a different report`);
        }
        identities.set(id, auth);
    }

    // An inspection that does not exist must be created by the package itself.
    const created = new Set<string>();
    for (const id of ids) {
        if (existing.has(id)) continue;
        if (!creates.has(id)) throw Errors.NotFound(`Inspection ${id} does not exist and the package does not create it`);
        created.add(id);
    }
    return { manifest, outbox, media, entries, identities, created };
}

/** The in-process request that replays one queued write with the caller's own credentials. */
function outboxRequest(c: Context<HonoConfig>, entry: OutboxEntry): Request {
    const { id, ...rest } = entry.payload;
    const headers = new Headers({ 'Idempotency-Key': entry.idempotencyKey });
    // Only the caller's credentials travel. Version-handshake and other client
    // headers do not: this is the server calling itself, not the device.
    for (const name of ['authorization', 'cookie']) {
        const v = c.req.header(name);
        if (v) headers.set(name, v);
    }
    const url = (path: string) => new URL(path, c.req.url);
    switch (entry.op) {
        case 'inspection.create':
            headers.set('content-type', 'application/json');
            return new Request(url('/api/inspections'), { method: 'POST', headers, body: JSON.stringify(entry.payload) });
        case 'inspection.update':
            headers.set('content-type', 'application/json');
            return new Request(url(`/api/inspections/${id}`), { method: 'PATCH', headers, body: JSON.stringify(rest) });
        case 'inspection.complete':
            return new Request(url(`/api/inspections/${id}/complete`), { method: 'POST', headers });
    }
}

function detailed(err: AppError, details: unknown): AppError {
    err.details = details;
    return err;
}

function failureFor(status: number, message: string, details: unknown): AppError {
    if (status === 401 || status === 403) return detailed(Errors.Forbidden(message), details);
    if (status === 404) return detailed(Errors.NotFound(message), details);
    if (status === 409) return detailed(Errors.Conflict(message), details);
    if (status === 422) return Errors.UnprocessableEntity(message, details);
    if (status >= 500) return Errors.ServiceUnavailable(message, details);
    return Errors.BadRequest(message, details);
}

function executionContext(c: Context<HonoConfig>): ExecutionContext | undefined {
    try { return c.executionCtx; } catch { return undefined; }
}

async function applyOutbox(c: Context<HonoConfig>, outbox: readonly OutboxEntry[]): Promise<{ applied: number; skipped: number }> {
    // Creates first, then the rest, each group in the order the device queued it.
    const ordered = [...outbox.filter((e) => e.op === 'inspection.create'), ...outbox.filter((e) => e.op !== 'inspection.create')];
    const { app } = await import('../index');
    let applied = 0;
    let skipped = 0;
    for (const entry of ordered) {
        const res = await app.fetch(outboxRequest(c, entry), c.env, executionContext(c));
        if (!res.ok) {
            logger.warn('offline import: a queued write was refused', { op: entry.op, status: res.status });
            throw failureFor(res.status, `Queued write ${entry.idempotencyKey} (${entry.op}) was refused`, {
                idempotencyKey: entry.idempotencyKey, op: entry.op, inspectionId: entry.payload.id, status: res.status,
            });
        }
        // A create that answers 200 found the inspection already there; any other
        // write is a repeat when the idempotency layer replayed its stored answer.
        const repeat = res.headers.get('Idempotency-Replayed') === 'true'
            || (entry.op === 'inspection.create' && res.status === 200);
        if (repeat) skipped++; else applied++;
    }
    return { applied, skipped };
}

/** Write each photo at the key its (tenant, inspection, pendingId) fixes; a repeat overwrites. */
async function storePhotos(c: Context<HonoConfig>, zip: Uint8Array, plan: ImportPlan, tenantId: string): Promise<Map<string, Record<string, string>>> {
    const keysByInspection = new Map<string, Record<string, string>>();
    const bucket = c.env.PHOTOS;
    if (plan.media.length > 0 && !bucket) throw Errors.ServiceUnavailable('Photo storage is unavailable');
    for (const m of plan.media) {
        const ext = signedPhotoExtFor(m.contentType);
        if (!ext || !bucket) continue; // unreachable: validate() proved both
        const name = mediaEntryName(m.pendingId, ext);
        const size = plan.entries.get(name);
        const bytes = size === undefined ? null : readPackageEntry(zip, name, size);
        if (!bytes) throw Errors.BadRequest(`Photo ${m.pendingId} could not be read from the package`);
        const key = r2Keys.inspectionPhoto(tenantId, m.inspectionId, m.pendingId, ext);
        await storePhotoAtKey(bucket, imagesBinding(c.env), key, new File([bytes], `${m.pendingId}.${ext}`, { type: m.contentType }));
        const keys = keysByInspection.get(m.inspectionId) ?? {};
        keys[m.pendingId] = key;
        keysByInspection.set(m.inspectionId, keys);
    }
    return keysByInspection;
}

function doFailure(status: number, inspectionId: string, reason: string, what: string): AppError {
    const details = { inspectionId, reason };
    const message = `${what} failed for inspection ${inspectionId}`;
    if (status === 422) return Errors.UnprocessableEntity(message, details);
    if (status === 400 || status === 413) return Errors.BadRequest(message, details);
    return Errors.ServiceUnavailable(message, details);
}

export async function importOfflinePackage(c: Context<HonoConfig>, zip: Uint8Array): Promise<OfflineImportResult> {
    const tenantId = c.get('tenantId');
    if (!tenantId) throw Errors.Unauthorized();

    const plan = await validate(c, zip);

    // ---- phase 2: writes -------------------------------------------------
    const outbox = await applyOutbox(c, plan.outbox);

    // Inspections the package just created need their own authorization now that they exist.
    for (const id of plan.created) {
        const auth = await authorizeCollab(c, id);
        if (!auth.ok) throw refusal(auth, id);
        plan.identities.set(id, auth);
    }

    const keysByInspection = await storePhotos(c, zip, plan, tenantId);

    const yjs = { changed: 0, unchanged: 0 };
    for (const { id } of plan.manifest.inspections) {
        const identity = plan.identities.get(id);
        if (!identity) throw Errors.Internal();
        const stub = collabStub(c, identity.tenantId, identity.reportId);
        const size = plan.entries.get(yjsEntryName(id));
        const update = size === undefined ? null : readPackageEntry(zip, yjsEntryName(id), size);
        if (!update) throw Errors.BadRequest(`Yjs state for inspection ${id} could not be read from the package`);

        const imported = await importUpdateIntoDo(stub, identity, update);
        if (!imported.ok) throw doFailure(imported.status, id, imported.reason, 'Importing the results');
        if (imported.changed) yjs.changed++; else yjs.unchanged++;

        const keys = keysByInspection.get(id);
        if (keys && Object.keys(keys).length > 0) {
            const resolved = await resolvePendingInDo(stub, identity, keys);
            if (!resolved.ok) throw doFailure(resolved.status, id, resolved.reason, 'Attaching the photos');
        }
    }

    const photos = plan.media.length;
    auditFromContext(c, 'native.offline_import', 'tenant', {
        entityId: tenantId,
        metadata: {
            exportedBy: plan.manifest.exportedBy,
            deviceId: plan.manifest.deviceId,
            inspections: plan.manifest.inspections.length,
            photos,
            applied: outbox.applied,
            skipped: outbox.skipped,
            changed: yjs.changed,
        },
    });
    return { inspections: plan.manifest.inspections.length, photos, outbox, yjs };
}
