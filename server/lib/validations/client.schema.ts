import { z } from '@hono/zod-openapi';
import { CLIENT_PLATFORMS } from '../native/client-version';
import { createApiResponseSchema } from './shared.schema';

export const ClientCompatQuerySchema = z.object({
    platform: z.enum(CLIENT_PLATFORMS).describe('Native client platform identifier'),
});

export const ClientCompatResponseSchema = createApiResponseSchema(z.object({
    minSupported: z.string().nullable().describe('Lowest app version still allowed to edit'),
    recommended: z.string().nullable().describe('Version the app should prompt users to install'),
    downloadUrl: z.string().nullable().describe('Where a sideloaded build can be downloaded'),
    serverContractVersion: z.number().int().describe('Native API contract version this server implements'),
    accountUrl: z.string().optional().describe('Https page where a person manages or deletes their account. Present only when the operator configured one; absent otherwise (never null or empty)'),
    videoUpload: z.object({
        path: z.string().describe('Base path of the chunked video upload routes, authorized by the signed token from create-upload'),
        chunkBytes: z.number().int().describe('Size of every part but the last'),
        maxBytes: z.number().int().describe('Largest video the chunked route accepts'),
        maxOpen: z.number().int().describe('Chunked uploads one member may have open at once'),
        methods: z.array(z.enum(['chunked', 'form'])).describe('Upload methods this server offers. A client that does not find chunked here uses the single-request route. A company may be served from another video backend: the provider in the create-upload answer decides, not this field'),
    }).optional().describe('How a large video may be uploaded. Absent on a server that predates chunked upload and when native clients are switched off here'),
}));

export const ClientSessionResponseSchema = createApiResponseSchema(z.object({
    userId: z.string().describe('Signed-in user identifier'),
    tenantId: z.string().describe('Tenant the session belongs to'),
    role: z.string().describe('Role of the signed-in user'),
    offlineMaxDays: z.number().int().describe('Days the device may stay offline before locking'),
    tenantName: z.string().nullable().describe('Display name the company set for itself, trimmed and cut to 200 characters, or null when it has none. Never replaced by a default name. A missing key means an older server'),
    serverNowMs: z.number().int().describe('The server clock when it answered this request, in whole milliseconds since the Unix epoch. Read on the server after all other work and never derived from anything the client sent. Treat it as the current time give or take network delay. The response is not cacheable. A missing key means an older server'),
}));

export const VisibleInspectionsRequestSchema = z.object({
    ids: z.array(z.string()).describe('Inspection ids the device holds locally. Between 1 and the server limit (300 by default; the limit is returned in details.limits.ids when exceeded). Each id is 1 to 64 characters from A-Z, a-z, 0-9, underscore and hyphen; a request that breaks any of these is refused whole with 422.'),
});

export const VisibleInspectionsResponseSchema = createApiResponseSchema(z.object({
    visible: z.array(z.string()).describe('The requested ids that exist in the signed-in company and that this member can see, in request order and without repeats. An id that was deleted, never existed, belongs to another company or is not assigned to this member is simply absent; the response never says which.'),
}));

export const ImportOfflinePackageResponseSchema = createApiResponseSchema(z.object({
    inspections: z.number().int().describe('Inspections the package covered'),
    photos: z.number().int().describe('Photos written to storage'),
    outbox: z.object({
        applied: z.number().int().describe('Queued writes executed by this import'),
        skipped: z.number().int().describe('Queued writes that had already been applied'),
        failed: z.array(z.object({
            idempotencyKey: z.string(),
            op: z.enum(['inspection.create', 'inspection.update', 'inspection.complete']),
            inspectionId: z.string(),
            status: z.number().int().describe('HTTP status the target route refused it with, or 424 when it was not attempted because of reason'),
            reason: z.enum(['blocked_by_failed_update']).optional().describe('Present when the write was not attempted: blocked_by_failed_update means an earlier queued update to the same inspection was refused, and completing the inspection without it would finish work the device never delivered. Later versions may add values; a client treats an unknown reason as "not attempted" and keeps the entry'),
        })).describe('Queued writes the server refused. The results and photos in the package were still imported; these entries need attention on the device.'),
    }),
    yjs: z.object({
        changed: z.number().int().describe('Inspections whose results changed'),
        unchanged: z.number().int().describe('Inspections whose results were already up to date'),
    }),
}));
