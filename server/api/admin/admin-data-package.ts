// Admin → tenant data-package sub-router (E-1 read API).
//
// The dumb Worker API for desktop-client-owned export/import. This router owns
// only authorization (native owner bearer + step-up at job start), the job/lease
// ledger, and paginated reads of the classification whitelist. It does NOT do
// the export work: the desktop client groups, hashes, zips and verifies bytes.
//
// Every data endpoint re-scopes the job by the verified tenant and requires the
// short-lived X-Data-Job token bound to that tenant/job/user (see job-access.ts).
// Application-layer daily budgets are DISABLED by owner decision: X-Dp-Budget
// is emitted as a measurement header only and never returns 429.
import { createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { createApiRouter } from '../../lib/openapi-router';
import { requireRole } from '../../lib/middleware/rbac';
import { requireStepUp } from '../../lib/auth/step-up';
import { checkRateLimit } from '../../lib/rate-limit';
import { eq } from 'drizzle-orm';
import { tenants } from '../../lib/db/schema';
import { isPaidPlan, type TenantPlan } from '../../features/plan-quota/policy';
import { withMcpMetadata } from '../../lib/route-metadata-standards';
import { getDrizzle } from '../../lib/route-helpers';
import type { DrizzleDB } from '../../lib/db/scoped';
import { auditFromContext } from '../../lib/audit';
import { Errors } from '../../lib/errors';
import type { HonoConfig } from '../../types/hono';
import { SERVER_CONTRACT_VERSION } from '../../lib/native/client-version';
import { DataPackageJobService, JOB_LEASE_TTL_MS } from '../../services/data-package/job.service';
import { DataPackageReadService } from '../../services/data-package/read.service';
import { authorizeDataJob } from '../../lib/data-package/job-access';
import { schemaFingerprint } from '../../lib/data-package/fingerprint';
import { TABLES_WITHOUT_KEYSET, type ReadProfile } from '../../lib/data-package/read-metadata';
import {
    CreateJobRequestSchema, CreateJobResponseSchema, HeartbeatResponseSchema,
    ResumeResponseSchema, CompleteJobRequestSchema, JobStateResponseSchema,
    JobListResponseSchema, TablesResponseSchema, RowsResponseSchema,
    SimpleResponseSchema,
} from '../../lib/validations/data-package.schema';

// ── Route definitions ────────────────────────────────────────────────────────

// Described request inputs. The route-metadata gate requires a >=10-char
// description on every OpenAPI parameter; one shared definition keeps the
// job id / blob column / X-Data-Job header wording identical across endpoints.
const JobIdParam = z.object({
    id: z.string().describe('Id of the data-package job this request acts on'),
});
const JobTokenHeader = z.object({
    'x-data-job': z.string().describe('Short-lived X-Data-Job token bound to this tenant, job and user'),
});
const BlobTableParam = JobIdParam.extend({
    table: z.string().describe('Exportable table whose keyset page is being read'),
});
const RowsQuery = z.object({
    after: z.string().optional().describe('Opaque continuation cursor returned as `next` by the previous page'),
    limit: z.string().optional().describe('Maximum rows in this page, capped by the classification ceiling'),
});

const createJobRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/data-package/jobs', operationId: 'createDataPackageJob',
    summary: 'Start a tenant data-package export or import job',
    description: 'Starts one export or import job and takes the company-wide lease (409 if another is active). Requires a step-up elevation for data-export-start. Returns a short-lived X-Data-Job token, the lease expiry, the row watermark and the export limits. Only an owner may call it.',
    tags: ['admin'],
    middleware: [requireRole('owner'), requireStepUp('data-export-start')],
    request: { body: { content: { 'application/json': { schema: CreateJobRequestSchema } } } },
    responses: {
        200: { content: { 'application/json': { schema: CreateJobResponseSchema } }, description: 'Job created and lease taken' },
        401: { description: 'Not signed in, or step-up required/expired' },
        403: { description: 'Only an owner may start a data job' },
        409: { description: 'Another job holds the lease (JOB_LEASE_HELD)' },
        429: { description: 'Too many attempts' },
    },
}, { scopes: ['admin'], tier: 'extended' }));

const heartbeatRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/data-package/jobs/:id/heartbeat', operationId: 'heartbeatDataPackageJob',
    summary: 'Renew a data-package job lease and token',
    description: 'Renews the lease and returns a fresh X-Data-Job token. The renewed expiry is persisted only when the lease is close to lapsing, to save D1 writes. Requires the current X-Data-Job token and a tenant-scoped active job. Only an owner may call it.',
    tags: ['admin'],
    middleware: [requireRole('owner')],
    request: { params: JobIdParam, headers: JobTokenHeader },
    responses: {
        200: { content: { 'application/json': { schema: HeartbeatResponseSchema } }, description: 'Lease renewed' },
        401: { description: 'Invalid or expired X-Data-Job token' },
        409: { description: 'Lease held by another device, or expired (JOB_LEASE_EXPIRED)' },
    },
}, { scopes: ['admin'], tier: 'extended' }));

const resumeRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/data-package/jobs/:id/resume', operationId: 'resumeDataPackageJob',
    summary: 'Resume a data-package job after its lease lapses',
    description: 'Reclaims a tenant job whose lease has lapsed and returns a fresh X-Data-Job token. No step-up: the job was already authorized at start, so a still-valid bearer resumes it (an accepted trade-off for multi-hour exports). The job must be younger than 14 days and still active. Only an owner may call it.',
    tags: ['admin'],
    middleware: [requireRole('owner')],
    request: { params: JobIdParam },
    responses: {
        200: { content: { 'application/json': { schema: ResumeResponseSchema } }, description: 'Job resumed' },
        401: { description: 'Not signed in' },
        404: { description: 'Not this company\'s job' },
        409: { description: 'Job is terminal or too old to resume' },
    },
}, { scopes: ['admin'], tier: 'extended' }));

const completeRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/data-package/jobs/:id/complete', operationId: 'completeDataPackageJob',
    summary: 'Record the client-declared result of a data-package job',
    description: 'Records the desktop client attested counts/bytes/sha256 and frees the lease (terminal complete). Values are attestations, not server-computed proofs. Requires the current X-Data-Job token. Only an owner may call it.',
    tags: ['admin'],
    middleware: [requireRole('owner')],
    request: {
        params: JobIdParam, headers: JobTokenHeader,
        body: { content: { 'application/json': { schema: CompleteJobRequestSchema } } },
    },
    responses: {
        200: { content: { 'application/json': { schema: SimpleResponseSchema } }, description: 'Job completed' },
        401: { description: 'Invalid X-Data-Job token' },
        409: { description: 'Job is terminal or its lease expired (JOB_LEASE_EXPIRED)' },
    },
}, { scopes: ['admin'], tier: 'extended' }));

const abortRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/data-package/jobs/:id/abort', operationId: 'abortDataPackageJob',
    summary: 'Abort a data-package job and free its lease',
    description: 'Terminates an active job and frees the lease (terminal cancelled). Requires the current X-Data-Job token. Only an owner may call it.',
    tags: ['admin'],
    middleware: [requireRole('owner')],
    request: { params: JobIdParam, headers: JobTokenHeader },
    responses: {
        200: { content: { 'application/json': { schema: SimpleResponseSchema } }, description: 'Job aborted' },
        401: { description: 'Invalid X-Data-Job token' },
        409: { description: 'Job is terminal or its lease expired (JOB_LEASE_EXPIRED)' },
    },
}, { scopes: ['admin'], tier: 'extended' }));

const listJobsRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/data-package/jobs', operationId: 'listDataPackageJobs',
    summary: 'List the company data-package jobs',
    description: 'Returns the company data-package job ledger, newest first, capped at 50. Read-only; no X-Data-Job token needed. Only an owner may call it.',
    tags: ['admin'], middleware: [requireRole('owner')],
    responses: { 200: { content: { 'application/json': { schema: JobListResponseSchema } }, description: 'Job list' } },
}, { scopes: ['admin'], tier: 'extended' }));

const getJobRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/data-package/jobs/:id', operationId: 'getDataPackageJob',
    summary: 'Get one data-package job by id',
    description: 'Returns one company job by id, scoped to the verified tenant. 404 when it is not this company\'s job. Read-only; no X-Data-Job token needed. Only an owner may call it.',
    tags: ['admin'], middleware: [requireRole('owner')],
    request: { params: JobIdParam },
    responses: {
        200: { content: { 'application/json': { schema: JobStateResponseSchema } }, description: 'Job state' },
        404: { description: 'Not this company\'s job' },
    },
}, { scopes: ['admin'], tier: 'extended' }));

const tablesRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/data-package/jobs/:id/tables', operationId: 'listDataPackageTables',
    summary: 'List exportable tables and their column whitelist',
    description: 'Returns the classification-derived table descriptors: the whitelisted columns, keyset, page ceilings and large blob columns for each exportable table. The list is decided by the server classification, never by the request; withheld/out columns never appear. Requires a valid X-Data-Job token.',
    tags: ['admin'], middleware: [requireRole('owner')],
    request: { params: JobIdParam, headers: JobTokenHeader },
    responses: {
        200: { content: { 'application/json': { schema: TablesResponseSchema } }, description: 'Table descriptors' },
        401: { description: 'Invalid X-Data-Job token' },
        409: { description: 'Job is terminal or its lease expired (JOB_LEASE_EXPIRED)' },
    },
}, { scopes: ['admin'], tier: 'extended' }));

const rowsRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/data-package/jobs/:id/tables/:table/rows', operationId: 'readDataPackageRows',
    summary: 'Read one keyset page of an exportable table',
    description: 'Returns one keyset page of a whitelisted table, scoped to the job tenant and cut at the job snapshot watermark. Stored values are returned verbatim. Pass the returned `next` cursor back as `after` to continue; the cursor is stateless and carries only keyset values. Page size is capped by the classification ceilings. Requires a valid X-Data-Job token.',
    tags: ['admin'], middleware: [requireRole('owner')],
    request: {
        params: BlobTableParam,
        headers: JobTokenHeader,
        query: RowsQuery,
    },
    responses: {
        200: { content: { 'application/json': { schema: RowsResponseSchema } }, description: 'One page of rows' },
        400: { description: 'Invalid cursor' },
        401: { description: 'Invalid X-Data-Job token' },
        404: { description: 'Table not part of the data package' },
        409: { description: 'Job is terminal or its lease expired (JOB_LEASE_EXPIRED)' },
    },
}, { scopes: ['admin'], tier: 'extended' }));

// ── Handlers ─────────────────────────────────────────────────────────────────

function envOf(c: Context<HonoConfig>) {
    // getDrizzle() is schema-agnostic (drizzle<any>); the data-package services
    // are typed against the full schema. The underlying D1 handle is identical.
    return {
        db: getDrizzle(c) as DrizzleDB,
        secret: c.env.JWT_SECRET,
        tenantId: c.get('tenantId')!,
        userId: c.get('user')!.sub,
    };
}

function jobService(c: Context<HonoConfig>) {
    const { db, secret } = envOf(c);
    return new DataPackageJobService(db, secret);
}

function stateView(job: Awaited<ReturnType<DataPackageJobService['get']>>) {
    return {
        id: job!.id, kind: job!.kind, status: job!.status, stage: job!.stage,
        leaseExpiresAt: job!.leaseExpiresAt?.toISOString() ?? null,
        createdAt: job!.createdAt.toISOString(),
        finishedAt: job!.finishedAt?.toISOString() ?? null,
        errorCode: job!.errorCode ?? null,
    };
}

/** Page ceilings follow the tenant's paid/free tier (self-host = free). */
async function resolveProfile(c: Context<HonoConfig>): Promise<ReadProfile> {
    const tenantId = c.get('tenantId');
    if (!tenantId) return 'worker-free';
    const rows = await getDrizzle(c).select({ tier: tenants.tier, status: tenants.status })
        .from(tenants).where(eq(tenants.id, tenantId)).limit(1).all();
    const plan: TenantPlan | null = rows[0]
        ? { tier: rows[0].tier, status: rows[0].status } as TenantPlan
        : null;
    return isPaidPlan(plan) ? 'worker-paid' : 'worker-free';
}

const PAGE_CEILINGS = {
    'worker-free': { maxPageRows: 48, maxPageBytes: 96 * 1024 },
    'worker-paid': { maxPageRows: 1000, maxPageBytes: 4 * 1024 * 1024 },
} as const;

/** Measurement-only budget header (application caps disabled). */
function budgetHeader(c: Context<HonoConfig>, profile: ReadProfile) {
    const caps = PAGE_CEILINGS[profile];
    c.header('X-Dp-Budget', `reads=0/0;writes=0/0;profile=${profile};pageRows=${caps.maxPageRows};pageBytes=${caps.maxPageBytes}`);
}

const app = createApiRouter();

app.openapi(createJobRoute, async (c) => {
    const { tenantId, userId } = envOf(c);
    await checkRateLimit(c, 'data-job-create');
    const body = c.req.valid('json');
    const snapshotAt = Date.now();
    const { job, jobToken } = await jobService(c).create(tenantId, {
        kind: body.kind, clientKind: body.clientKind, deviceLabel: body.deviceLabel,
        createdBy: userId, ...(body.packageId ? { packageId: body.packageId } : {}),
    });
    auditFromContext(c, 'data.export', 'bulk_export', { metadata: { phase: 'start', kind: body.kind, jobId: job.id } });
    const profile = await resolveProfile(c);
    budgetHeader(c, profile);
    if (TABLES_WITHOUT_KEYSET.length) {
        // Defensive: a misconfigured classification must not silently ship an
        // incomplete export. This is a server bug, not a client error.
        throw new Error(`Exportable tables without a keyset: ${TABLES_WITHOUT_KEYSET.join(', ')}`);
    }
    return c.json({
        success: true as const,
        data: {
            jobId: job.id, jobToken,
            leaseExpiresAt: new Date((job.leaseExpiresAt?.getTime() ?? snapshotAt + JOB_LEASE_TTL_MS)).toISOString(),
            snapshotAt, serverVersion: String(SERVER_CONTRACT_VERSION),
            schemaFingerprint: await schemaFingerprint(),
            limits: PAGE_CEILINGS[profile],
        },
    }, 200);
});

async function authorize(c: Context<HonoConfig>, jobId: string) {
    const { db, secret, tenantId, userId } = envOf(c);
    const token = c.req.header('X-Data-Job');
    const job = await authorizeDataJob(db, secret, { tenantId, userId, jobId, token });
    return { job, db };
}

app.openapi(heartbeatRoute, async (c) => {
    const { id: jobId } = c.req.valid('param');
    const { job, db } = await authorize(c, jobId);
    const secret = c.env.JWT_SECRET;
    const hb = await new DataPackageJobService(db, secret).heartbeat(job.tenantId, job.id, job.leaseHolder ?? '');
    return c.json({ success: true as const, data: { jobToken: hb.jobToken, leaseExpiresAt: new Date(hb.leaseExpiresAt).toISOString() } }, 200);
});

app.openapi(resumeRoute, async (c) => {
    const { id: jobId } = c.req.valid('param');
    const { tenantId, userId } = envOf(c);
    await checkRateLimit(c, 'data-job-resume', userId);
    const { db, secret } = envOf(c);
    const svc = new DataPackageJobService(db, secret);
    // Resume is bearer-only (the lease lapsed, so the old token may be gone).
    // The tenant-scoped get IS the re-scope: a job outside this tenant is a
    // 404, and the same-owner rule is enforced by requiring the verified owner
    // to hold the bearer. No step-up: the job was already authorized at start.
    const existing = await svc.get(tenantId, jobId);
    if (!existing) throw Errors.NotFound('Data job not found.');
    const resumed = await svc.resume(tenantId, jobId, existing.leaseHolder ?? 'resumed');
    return c.json({ success: true as const, data: { jobToken: resumed.jobToken, leaseExpiresAt: new Date(resumed.job.leaseExpiresAt?.getTime() ?? Date.now() + JOB_LEASE_TTL_MS).toISOString() } }, 200);
});

app.openapi(completeRoute, async (c) => {
    const { id: jobId } = c.req.valid('param');
    const { job, db } = await authorize(c, jobId);
    const body = c.req.valid('json');
    await new DataPackageJobService(db, c.env.JWT_SECRET).complete(job.tenantId, job.id, {
        ...(body.counts !== undefined ? { counts: body.counts } : {}),
        ...(body.bytes !== undefined ? { bytes: body.bytes } : {}),
        ...(body.sha256 !== undefined ? { sha256: body.sha256 } : {}),
    });
    auditFromContext(c, 'data.export', 'bulk_export', { metadata: { phase: 'complete', jobId, bytes: body.bytes ?? 0, sha256: body.sha256 ?? null } });
    return c.json({ success: true as const }, 200);
});

app.openapi(abortRoute, async (c) => {
    const { id: jobId } = c.req.valid('param');
    const { job, db } = await authorize(c, jobId);
    await new DataPackageJobService(db, c.env.JWT_SECRET).abort(job.tenantId, job.id, 'cancelled_by_user');
    auditFromContext(c, 'data.export', 'bulk_export', { metadata: { phase: 'abort', jobId } });
    return c.json({ success: true as const }, 200);
});

app.openapi(listJobsRoute, async (c) => {
    const { tenantId, db, secret } = envOf(c);
    const jobs = await new DataPackageJobService(db, secret).list(tenantId);
    return c.json({ success: true as const, data: jobs.map(stateView) }, 200);
});

app.openapi(getJobRoute, async (c) => {
    const { id: jobId } = c.req.valid('param');
    const { tenantId, db, secret } = envOf(c);
    const job = await new DataPackageJobService(db, secret).get(tenantId, jobId);
    if (!job) throw Errors.NotFound('Data job not found.');
    return c.json({ success: true as const, data: stateView(job) }, 200);
});

app.openapi(tablesRoute, async (c) => {
    const { id: jobId } = c.req.valid('param');
    const { job } = await authorize(c, jobId);
    const { db } = envOf(c);
    const profile = await resolveProfile(c);
    const reader = new DataPackageReadService(db);
    budgetHeader(c, profile);
    return c.json({ success: true as const, data: reader.tables(profile), snapshotAt: job.createdAt.getTime() }, 200);
});

app.openapi(rowsRoute, async (c) => {
    const { id: jobId, table } = c.req.valid('param');
    const { job, db } = await authorize(c, jobId);
    const { after, limit } = c.req.valid('query');
    const reader = new DataPackageReadService(db);
    const profile = await resolveProfile(c);
    budgetHeader(c, profile);
    const page = await reader.readRows(
        job.tenantId, table, after,
        limit !== undefined ? Number(limit) : Number.NaN,
        job.createdAt.getTime(), profile,
    );
    return c.json({ success: true as const, data: page }, 200);
});

/** Registration order. Drives the typed client; a test pins it to what `app` registered. */
export const adminDataPackageRouteConfigs = [
    createJobRoute, heartbeatRoute, resumeRoute, completeRoute, abortRoute,
    listJobsRoute, getJobRoute, tablesRoute, rowsRoute,
] as const;

export default app;
