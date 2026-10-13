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
