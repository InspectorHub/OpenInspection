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
import { requireRole } from '../../lib/middleware/rbac';
import { requireStepUp } from '../../lib/auth/step-up';
import { withMcpMetadata } from '../../lib/route-metadata-standards';
import { DataPackagePreflightService } from '../../services/data-package/preflight.service';
import { DataPackageApplyService } from '../../services/data-package/import-apply.service';
import { auditFromContext } from '../../lib/audit';
import { authorize, envOf } from './data-package-route-helpers';
import { getDeploymentProfile } from '../../lib/deployment-profile';
import { schemaFingerprint } from '../../lib/data-package/fingerprint';
import { IMPORT_TIERS } from '../../lib/data-package/import-plan';

const JobIdParam = z.object({ id: z.string().describe('Id of the data-package import job') });
const JobTokenHeader = z.object({ 'x-data-job': z.string().describe('Short-lived X-Data-Job token bound to this tenant and job') });

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

export const adminDataPackageImportRouteConfigs = [importPlanRoute, preflightRoute, applyBatchRoute] as const;

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

export default app;
