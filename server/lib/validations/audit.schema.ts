import { z } from '@hono/zod-openapi';
import { createApiResponseSchema } from './shared.schema';

export const EntityAuditParamsSchema = z.object({
    entityId: z.string().min(1).describe('The id of the template / comment / entity whose change history is requested.'),
});

export const EntityAuditQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(20).describe('Maximum number of history rows to return, newest first.'),
});

const AuditEntrySchema = z.object({
    id:        z.string().describe('Audit log row id.'),
    action:    z.string().describe('The audited action, e.g. template.update.'),
    actorId:   z.string().nullable().describe('User id who performed the action, when known.'),
    actorName: z.string().nullable().describe('Display name of the actor, falling back to null when the user is gone.'),
    createdAt: z.number().describe('Epoch-ms timestamp of the action.'),
});

export const EntityAuditResponseSchema = createApiResponseSchema(
    z.object({
        entries: z.array(AuditEntrySchema).describe('Change history for the entity, newest first.'),
    }),
);
