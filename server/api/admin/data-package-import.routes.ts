/**
 * Data-package import router. Kept as its own OpenAPIHono router (mounted at
 * the root of the admin router) so the main data-package file stays under the
 * 400-line ratchet and so retry-safety sees the `.openapi(routeConst)` registrations.
 *
 * All three endpoints re-scope the job by verified tenant + X-Data-Job token
 * (authorize); the apply endpoint additionally requires a step-up.
 */
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { eq, and } from 'drizzle-orm';
import { requireRole } from '../../lib/middleware/rbac';
import { requireStepUp } from '../../lib/auth/step-up';
import { withMcpMetadata } from '../../lib/route-metadata-standards';
import { DataPackagePreflightService } from '../../services/data-package/preflight.service';
import { DataPackageApplyService } from '../../services/data-package/import-apply.service';
import { DataPackageRevertService } from '../../services/data-package/import-revert.service';
import { DataPackageMediaImportService } from '../../services/data-package/import-media.service';
import { DataPackageArchiveImportService } from '../../services/data-package/import-archive.service';
import { readBoundedBody } from '../../lib/bounded-body';
import { auditFromContext } from '../../lib/audit';
import { authorize, envOf } from './data-package-route-helpers';
import { getDeploymentProfile } from '../../lib/deployment-profile';
import { schemaFingerprint } from '../../lib/data-package/fingerprint';
import { IMPORT_TIERS } from '../../lib/data-package/import-plan';
import { importArchives } from '../../lib/db/schema/data-package';
import { EVIDENCE_ARCHIVE_KEY } from '../../services/data-package/import-archive.service';
import { verifyEvidenceChainDetailed, type PackEvent, type PackKey } from '../../lib/esign/chain-verify';
import { r2Get } from '../../lib/r2/objects';

const JobIdParam = z.object({ id: z.string().describe('Id of the data-package import job') });
const JobTokenHeader = z.object({ 'x-data-job': z.string().describe('Short-lived X-Data-Job token bound to this tenant and job') });

/** One media object's bytes travel in the body; its metadata in the query. A
 *  single object is bounded well below the Worker body limit (photos/videos are
 *  individually stored objects). */
const MEDIA_OBJECT_MAX_BYTES = 64 * 1024 * 1024;
const MediaQuery = z.object({
    key: z.string().min(1).max(1024).describe('Source object key from the package media index'),
    sha256: z.string().regex(/^[a-f0-9]{64}$/).describe('SHA-256 hex digest of the media bytes'),
    bytes: z.coerce.number().int().nonnegative().describe('Declared byte length of the media object'),
    content_type: z.string().min(1).max(128).describe('MIME content type of the media object'),
    entry: z.string().min(1).max(1024).describe('Zip entry name the media was read from'),
    volume: z.string().min(1).max(256).describe('Package volume name containing this media object'),
}).openapi('DataPackageMediaUploadQuery');
// Events are validated with the exact PackEvent shape the chain verifier reads.
// A missing `prevHash` would make verifyEvidenceChainDetailed call
// `prev.slice(0,12)` on undefined and throw; strict validation turns that into
// a 400 instead of a 500. Fields mirror `PackEvent` (camelCase) — the same shape
// DataPackageArchiveImportService stores and the import-archive tests use.
const ArchiveEvent = z.object({
    id: z.string(),
    event: z.string(),
    payloadJson: z.string(),
    prevHash: z.string().nullable(),
    hash: z.string(),
    signature: z.string(),
    keyFingerprint: z.string(),
});
const ArchiveBody = z.object({
    events: z.array(ArchiveEvent).max(100000),
    keys: z.array(z.object({ fingerprint: z.string(), pem: z.string() })).max(10000),
}).openapi('DataPackageArchiveUploadRequest');

const PreflightBody = z.object({
    formatVersion: z.number().int(),
    columnFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    schemaVersion: z.string().min(1).max(128),
    sourceTenantId: z.string().min(1).max(256),
    sourceMode: z.enum(['standalone', 'saas']),
    counts: z.record(z.string(), z.number().int().nonnegative()),
    answers: z.record(z.string(), z.string()).optional(),
    lenient: z.boolean().optional(),
    countsDigest: z.string().max(128).optional().describe('Client-declared counts digest, recorded in audit only'),
}).openapi('DataPackagePreflightRequest');

const BatchBody = z.object({
    table: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    rows: z.array(z.record(z.string(), z.unknown())).max(1000),
}).openapi('DataPackageImportBatchRequest');

const PreflightResponse = z.object({
    success: z.literal(true),
    data: z.object({
        ok: z.boolean(),
        reasons: z.array(z.string()),
        advisories: z.array(z.string()),
        keepIds: z.boolean(),
        estimate: z.object({ rows: z.number().int(), writes: z.number().int(), days: z.number().int() }),
        questions: z.array(z.object({ id: z.string(), prompt: z.string() })),
        fingerprintClass: z.enum(['current', 'known-old', 'unknown']),
    }),
}).openapi('DataPackagePreflightResponse');

const BatchResponse = z.object({
    success: z.literal(true),
    data: z.object({
        created: z.record(z.string(), z.number().int()),
        skipped: z.record(z.string(), z.number().int()),
        rejected: z.array(z.object({ table: z.string(), sourceId: z.string(), code: z.string() })),
    }),
}).openapi('DataPackageImportBatchResponse');

const RevertStepBody = z.object({
    limit: z.number().int().min(1).max(1000).optional().describe('Max mappings to process in this step'),
}).openapi('DataPackageImportRevertStepRequest');

const RevertStepResponse = z.object({
    success: z.literal(true),
    data: z.object({
        done: z.boolean(),
        processed: z.number().int(),
        deleted: z.record(z.string(), z.number().int()),
        kept: z.array(z.object({ table: z.string(), newId: z.string(), reason: z.string() })),
        mediaDeleted: z.number().int(),
        errors: z.array(z.object({ table: z.string(), newId: z.string(), code: z.string() })),
    }),
}).openapi('DataPackageImportRevertStepResponse');

const importPlanRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/data-package/jobs/:id/import/plan', operationId: 'getDataPackageImportPlan',
    summary: 'Get the referential write order for import',
    description: 'Returns the table tiers the importer writes in, so each row is applied after its package-table parents. Read-only. Requires a valid X-Data-Job token and an owner.',
    tags: ['admin'], middleware: [requireRole('owner')],
    request: { params: JobIdParam, headers: JobTokenHeader },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.object({ tiers: z.array(z.array(z.string())) }) }) } },
            description: 'Import tiers',
        },
        401: { description: 'Invalid X-Data-Job token' },
    },
}, { scopes: ['admin'], tier: 'extended' }));

const preflightRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/data-package/jobs/:id/import/preflight', operationId: 'preflightDataPackageImport',
    summary: 'Preflight a declared package against the target workspace',
    description: 'Checks format/version window, column fingerprint, row cap, blank-target keep-ids precondition and estimates D1 writes/days. Read-only: no package row is written. Requires a valid X-Data-Job token and an owner.',
    tags: ['admin'], middleware: [requireRole('owner')],
    request: { params: JobIdParam, headers: JobTokenHeader, body: { content: { 'application/json': { schema: PreflightBody } } } },
    responses: {
        200: { content: { 'application/json': { schema: PreflightResponse } }, description: 'Preflight result' },
        401: { description: 'Invalid X-Data-Job token' },
    },
}, { scopes: ['admin'], tier: 'extended' }));

const applyBatchRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/data-package/jobs/:id/import/batches', operationId: 'applyDataPackageImportBatch',
    summary: 'Apply one batch of package rows',
    description: 'Writes one batch of one table in referential order, idempotent by source id, tenant-scoped from the job. Bad rows are reported, not fatal. Requires a valid X-Data-Job token, an owner and a step-up.',
    tags: ['admin'], middleware: [requireRole('owner'), requireStepUp('data-import-apply')],
    request: { params: JobIdParam, headers: JobTokenHeader, body: { content: { 'application/json': { schema: BatchBody } } } },
    responses: {
        200: { content: { 'application/json': { schema: BatchResponse } }, description: 'Batch result' },
        401: { description: 'Invalid token or step-up' },
    },
}, { scopes: ['admin'], tier: 'extended' }));

const revertStepRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/data-package/jobs/:id/revert/step', operationId: 'revertDataPackageImportStep',
    summary: 'Undo one step of a data-package import',
    description: 'Irreversibly removes one bounded batch of every row/media the import wrote, in child-first order. This DELETES all imported rows unconditionally — including any the owner edited since the import — except protected identity roots (tenants/users). The evidence archive is kept for audit. Client loops until `done`. Requires a valid X-Data-Job token, an owner and a step-up.',
    tags: ['admin'], middleware: [requireRole('owner'), requireStepUp('data-import-revert')],
    request: { params: JobIdParam, headers: JobTokenHeader, body: { content: { 'application/json': { schema: RevertStepBody } } } },
    responses: {
        200: { content: { 'application/json': { schema: RevertStepResponse } }, description: 'Revert step result' },
        401: { description: 'Invalid token or step-up' },
    },
}, { scopes: ['admin'], tier: 'extended' }));

const archiveListRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/data-package/jobs/:id/import/archives', operationId: 'listDataPackageImportArchives',
    summary: 'List imported evidence archives',
    description: 'Lists the byte-identical evidence archives restored into this workspace. Read-only: no signing record is created or modified. Requires a valid X-Data-Job token and an owner.',
    tags: ['admin'], middleware: [requireRole('owner')],
    request: { params: JobIdParam, headers: JobTokenHeader },
    responses: {
        200: { description: 'Archive list' },
        401: { description: 'Invalid X-Data-Job token' },
    },
}, { scopes: ['admin'], tier: 'extended' }));

const archiveDetailRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/data-package/jobs/:id/import/archives/:packageId', operationId: 'getDataPackageImportArchive',
    summary: 'Inspect one imported evidence archive',
    description: 'Reads back the archived evidence bytes and re-runs the chain verifier over them. Read-only: no signing record is created or modified. Requires a valid X-Data-Job token and an owner.',
    tags: ['admin'], middleware: [requireRole('owner')],
    request: { params: JobIdParam.extend({ packageId: z.string().min(1).describe('Package whose evidence archive is inspected') }), headers: JobTokenHeader },
    responses: {
        200: { description: 'Archive detail and verification verdict' },
        401: { description: 'Invalid X-Data-Job token' },
        404: { description: 'Archive not found' },
    },
}, { scopes: ['admin'], tier: 'extended' }));

const mediaUploadRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/data-package/jobs/:id/import/media', operationId: 'uploadDataPackageImportMedia',
    summary: 'Upload one media object for the import',
    description: 'Copies one package media object into R2 under the target tenant, verifying its sha256 on write. Metadata is in the query string; raw bytes in the body with Content-Length. Requires a valid X-Data-Job token, an owner and a step-up.',
    tags: ['admin'], middleware: [requireRole('owner'), requireStepUp('data-import-apply')],
    request: {
        params: JobIdParam, headers: JobTokenHeader, query: MediaQuery,
        body: { content: { 'application/octet-stream': { schema: z.string() } } },
    },
    responses: {
        200: { description: 'Media stored (or already imported)' },
        400: { description: 'Malformed request' },
        411: { description: 'Content-Length required' },
        413: { description: 'Object too large' },
        422: { description: 'Checksum mismatch / unsafe key / write failed' },
    },
}, { scopes: ['admin'], tier: 'extended' }));

const archiveUploadRoute = createRoute(withMcpMetadata({
    method: 'put', path: '/data-package/jobs/:id/import/archive', operationId: 'uploadDataPackageImportArchive',
    summary: 'Upload the evidence archive for the import',
    description: 'Stores the package evidence (events + signing keys) as a byte-identical R2 object plus a ledger row, verified with the same chain verifier as a downloadable pack. Idempotent by (tenant, package). Requires a valid X-Data-Job token, an owner and a step-up.',
    tags: ['admin'], middleware: [requireRole('owner'), requireStepUp('data-import-apply')],
    request: { params: JobIdParam, headers: JobTokenHeader, body: { content: { 'application/json': { schema: ArchiveBody } } } },
    responses: {
        200: { description: 'Archive stored (or already archived) with verification verdict' },
        400: { description: 'Malformed body' },
    },
}, { scopes: ['admin'], tier: 'extended' }));

export const adminDataPackageImportRouteConfigs = [importPlanRoute, preflightRoute, applyBatchRoute, revertStepRoute, mediaUploadRoute, archiveUploadRoute, archiveListRoute, archiveDetailRoute] as const;

const app = createApiRouter();

app.openapi(importPlanRoute, async (c) => {
    await authorize(c, c.req.param('id'));
    return c.json({ success: true as const, data: { tiers: IMPORT_TIERS } }, 200);
});

app.openapi(preflightRoute, async (c) => {
    const jobId = c.req.valid('param').id;
    const { job } = await authorize(c, jobId);
    const body = c.req.valid('json');
    const svc = new DataPackagePreflightService(envOf(c).db, {
        now: () => Date.now(), profile: getDeploymentProfile(c.env), schemaFingerprint,
    });
    const result = await svc.run(job.tenantId, {
        formatVersion: body.formatVersion, columnFingerprint: body.columnFingerprint,
        schemaVersion: body.schemaVersion, sourceTenantId: body.sourceTenantId,
        sourceMode: body.sourceMode, counts: body.counts,
        ...(body.answers !== undefined ? { answers: body.answers } : {}),
        ...(body.lenient !== undefined ? { lenient: body.lenient } : {}),
    });
    auditFromContext(c, 'data.import.preview', 'bulk_import', {
        metadata: { jobId, counts: body.countsDigest ?? '', sha256: body.columnFingerprint },
    });
    return c.json({ success: true as const, data: {
        ok: result.ok, reasons: result.reasons, advisories: result.advisories,
        keepIds: result.keepIds, estimate: result.estimate, questions: result.questions,
        fingerprintClass: result.fingerprintClass,
    } }, 200);
});

app.openapi(applyBatchRoute, async (c) => {
    const jobId = c.req.valid('param').id;
    const { job, db } = await authorize(c, jobId);
    const body = c.req.valid('json');
    // Rewrite is the safe default; wiring the preflight keep-ids decision into
    // apply requires persisting it on the job ledger (follow-up).
    const svc = new DataPackageApplyService(db, {
        now: () => Date.now(), genId: () => crypto.randomUUID(), keepIds: false,
    });
    const result = await svc.applyBatch(job.tenantId, job.packageId ?? jobId, body.table, body.rows);
    auditFromContext(c, 'data.import.apply', 'bulk_import', {
        metadata: { jobId, counts: String((result.created[body.table] ?? 0) + (result.skipped[body.table] ?? 0)), sha256: job.sha256 ?? '' },
    });
    return c.json({ success: true as const, data: result }, 200);
});

app.openapi(revertStepRoute, async (c) => {
    const jobId = c.req.valid('param').id;
    const { job, db } = await authorize(c, jobId);
    const body = c.req.valid('json');
    const svc = new DataPackageRevertService(db, c.env.PHOTOS);
    const result = await svc.revertStep(job.tenantId, job.packageId ?? jobId, body.limit);
    const counts = Object.values(result.deleted).reduce((a, b) => a + b, 0);
    auditFromContext(c, 'data.import.revert', 'bulk_import', {
        metadata: { jobId, counts: String(counts), sha256: job.sha256 ?? '' },
    });
    return c.json({ success: true as const, data: result }, 200);
});

app.openapi(mediaUploadRoute, async (c) => {
    const jobId = c.req.valid('param').id;
    const { job, db } = await authorize(c, jobId);
    const q = c.req.valid('query');
    const body = await readBoundedBody(c.req.raw, MEDIA_OBJECT_MAX_BYTES, 413);
    if (!body.ok) return c.json({ success: false, error: { code: 'BAD_BODY', message: 'Media body missing, malformed or too large.' } }, body.status);
    const svc = new DataPackageMediaImportService(db, c.env.PHOTOS, {
        now: () => Date.now(), genId: () => crypto.randomUUID(), keepIds: false,
    });
    const result = await svc.importOne(job.tenantId, job.packageId ?? jobId, {
        key: q.key, entry: q.entry, bytes: q.bytes, sha256: q.sha256,
        volume: q.volume, content_type: q.content_type, referenced_by: [],
    }, body.bytes);
    if (result.ok) {
        auditFromContext(c, 'data.import.apply', 'bulk_import', {
            metadata: { jobId, counts: '1', sha256: result.sha256 },
        });
        return c.json({ success: true as const, data: { ok: true, newKey: result.newKey, sha256: result.sha256 } }, 200);
    }
    if (result.code === 'already_imported') {
        return c.json({ success: true as const, data: { ok: false, code: result.code } }, 200);
    }
    return c.json({ success: false, error: { code: 'MEDIA_REJECTED', message: 'Media object rejected.', reason: result.code } }, 422);
});

app.openapi(archiveUploadRoute, async (c) => {
    const jobId = c.req.valid('param').id;
    const { job, db } = await authorize(c, jobId);
    const body = c.req.valid('json');
    const events: PackEvent[] = body.events;
    const keys = body.keys;
    // Source ids are the distinct event ids the archived chain covers; they let
    // the read-side viewer attribute archived evidence to envelope ids.
    const sourceIds = [...new Set(events.map((e) => e.id))];
    const bytes = new TextEncoder().encode(JSON.stringify({ events, keys }));
    const svc = new DataPackageArchiveImportService(db, c.env.PHOTOS, {
        now: () => Date.now(), genId: () => crypto.randomUUID(),
    });
    const result = await svc.archive(job.tenantId, job.packageId ?? jobId, events, keys, bytes, sourceIds);
    if (!result.ok) {
        return c.json({ success: true as const, data: { ok: false, code: result.code } }, 200);
    }
    auditFromContext(c, 'data.import.apply', 'bulk_import', {
        metadata: { jobId, counts: String(events.length), sha256: result.sha256 },
    });
    return c.json({ success: true as const, data: {
        ok: true, verdict: result.verdict, sha256: result.sha256, key: result.key,
    } }, 200);
});

app.openapi(archiveListRoute, async (c) => {
    const { id: jobId } = c.req.valid('param');
    const { job, db } = await authorize(c, jobId);
    const rows = await db.select().from(importArchives)
        .where(eq(importArchives.tenantId, job.tenantId)).all();
    return c.json({ success: true as const, data: {
        archives: rows.map((r) => ({
            packageId: r.packageId, sha256: r.sha256,
            counts: r.counts ? JSON.parse(r.counts) : null,
            createdAt: new Date(r.createdAt).toISOString(),
        })),
    } }, 200);
});

app.openapi(archiveDetailRoute, async (c) => {
    const { id: jobId, packageId } = c.req.valid('param');
    const { job, db } = await authorize(c, jobId);
    const rows = await db.select().from(importArchives).where(and(
        eq(importArchives.tenantId, job.tenantId), eq(importArchives.packageId, packageId),
    )).limit(1).all();
    const row = rows[0];
    if (!row) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Archive not found.' } }, 404);
    const obj = await r2Get(c.env.PHOTOS, EVIDENCE_ARCHIVE_KEY(job.tenantId, packageId));
    if (!obj) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Archive bytes not found.' } }, 404);
    const parsed = JSON.parse(await obj.text()) as { events: PackEvent[]; keys: PackKey[] };
    const verdict = await verifyEvidenceChainDetailed(parsed.events ?? [], parsed.keys ?? []);
    return c.json({ success: true as const, data: {
        packageId: row.packageId, sha256: row.sha256,
        counts: row.counts ? JSON.parse(row.counts) : null,
        sourceIds: row.sourceIds ? JSON.parse(row.sourceIds) : [],
        createdAt: new Date(row.createdAt).toISOString(),
        verdict,
    } }, 200);
});

export default app;
