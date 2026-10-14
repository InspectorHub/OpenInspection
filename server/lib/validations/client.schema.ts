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
}));

export const ClientSessionResponseSchema = createApiResponseSchema(z.object({
    userId: z.string().describe('Signed-in user identifier'),
    tenantId: z.string().describe('Tenant the session belongs to'),
    role: z.string().describe('Role of the signed-in user'),
    offlineMaxDays: z.number().int().describe('Days the device may stay offline before locking'),
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
            reason: z.enum(['blocked_by_failed_update']).optional().describe('Present when the write was not attempted: blocked_by_failed_update means an earlier queued update to the same inspection was refused, and completing the inspection without it would finish work the device never delivered'),
        })).describe('Queued writes the server refused. The results and photos in the package were still imported; these entries need attention on the device.'),
    }),
    yjs: z.object({
        changed: z.number().int().describe('Inspections whose results changed'),
        unchanged: z.number().int().describe('Inspections whose results were already up to date'),
    }),
}));
