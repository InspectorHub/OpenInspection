import { z } from '@hono/zod-openapi';
import { DATA_JOB_KINDS, DATA_JOB_ERROR_CODES } from '../db/schema/data-package';

/** POST /api/admin/data-package/jobs — start an export/import and take the lease. */
export const CreateJobRequestSchema = z.object({
    kind: z.enum(DATA_JOB_KINDS).openapi({ example: 'export', description: 'Direction of the job.' }),
    clientKind: z.string().min(1).max(64).openapi({ example: 'desktop-windows', description: 'Desktop platform label, recorded for the lease.' }),
    deviceLabel: z.string().min(1).max(128).openapi({ example: 'office-laptop', description: 'Non-PII device label for the lease holder.' }),
    packageId: z.string().min(1).max(128).optional().openapi({ example: 'pkg_01H...', description: 'Optional package id minted by the client.' }),
}).openapi('DataPackageCreateJobRequest');

export const LimitsSchema = z.object({
    maxPageRows: z.number().int().nonnegative(),
    maxPageBytes: z.number().int().nonnegative(),
}).openapi('DataPackageLimits');

export const CreateJobResponseSchema = z.object({
    success: z.literal(true),
    data: z.object({
        jobId: z.string(),
        jobToken: z.string().describe('Short-lived (1h) credential for X-Data-Job on data endpoints.'),
        leaseExpiresAt: z.string().describe('ISO 8601 time the lease lapses without a heartbeat.'),
        snapshotAt: z.number().int().describe('Row watermark (epoch ms): rows created after it are excluded from this job.'),
        serverVersion: z.string(),
        schemaFingerprint: z.string(),
        limits: LimitsSchema,
    }),
}).openapi('DataPackageCreateJobResponse');

/** A heartbeat renews the lease + token. */
export const HeartbeatResponseSchema = z.object({
    success: z.literal(true),
    data: z.object({
        jobToken: z.string(),
        leaseExpiresAt: z.string(),
    }),
}).openapi('DataPackageHeartbeatResponse');

/** A resume reclaims an expired lease. */
export const ResumeResponseSchema = HeartbeatResponseSchema.openapi('DataPackageResumeResponse');

/** Complete records the client's attested result. */
export const CompleteJobRequestSchema = z.object({
    counts: z.string().max(4096).optional().describe('Serialized per-table counts (opaque to the server).'),
    bytes: z.number().int().nonnegative().optional(),
    sha256: z.string().max(128).optional(),
}).openapi('DataPackageCompleteJobRequest');

export const JobStateSchema = z.object({
    id: z.string(),
    kind: z.string(),
    status: z.string(),
    stage: z.string(),
    leaseExpiresAt: z.string().nullable(),
    createdAt: z.string(),
    finishedAt: z.string().nullable(),
    errorCode: z.string().nullable(),
}).openapi('DataPackageJobState');

export const JobStateResponseSchema = z.object({
    success: z.literal(true),
    data: JobStateSchema,
}).openapi('DataPackageJobStateResponse');

export const JobListResponseSchema = z.object({
    success: z.literal(true),
    data: z.array(JobStateSchema),
}).openapi('DataPackageJobListResponse');

/** GET /tables — one descriptor per exportable table. */
export const TableDescriptorSchema = z.object({
    table: z.string(),
    disposition: z.string(),
    columns: z.array(z.string()),
    keyset: z.array(z.string()),
    maxPageRows: z.number().int(),
    maxPageBytes: z.number().int(),
    blobColumns: z.array(z.object({ property: z.string(), name: z.string() })),
}).openapi('DataPackageTableDescriptor');

export const TablesResponseSchema = z.object({
    success: z.literal(true),
    data: z.array(TableDescriptorSchema),
    snapshotAt: z.number().int(),
}).openapi('DataPackageTablesResponse');

/** GET /rows — one keyset page. */
export const RowSchema = z.record(z.string(), z.unknown()).openapi('DataPackageRow');
export const RowsResponseSchema = z.object({
    success: z.literal(true),
    data: z.object({
        rows: z.array(RowSchema),
        next: z.string().nullable(),
        bytes: z.number().int(),
        rowsScanned: z.number().int(),
    }),
}).openapi('DataPackageRowsResponse');

/** GET /media — one tenant media object descriptor (key relative to the tenant prefix). */
export const MediaObjectSchema = z.object({
    key: z.string().describe('R2 object key relative to the tenant prefix.'),
    size: z.number().int().nonnegative(),
    etag: z.string(),
    uploaded: z.number().int().describe('R2 upload time as epoch milliseconds.'),
    contentType: z.string(),
}).openapi('DataPackageMediaObject');

export const MediaListResponseSchema = z.object({
    success: z.literal(true),
    data: z.object({
        objects: z.array(MediaObjectSchema),
        cursor: z.string().nullable(),
        truncated: z.boolean(),
    }),
    snapshotAt: z.number().int().optional(),
}).openapi('DataPackageMediaListResponse');

export const ErrorCodeSchema = z.enum(DATA_JOB_ERROR_CODES);

export const SimpleResponseSchema = z.object({ success: z.literal(true) }).openapi('DataPackageSimpleResponse');
