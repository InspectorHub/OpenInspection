import { z } from '@hono/zod-openapi';
import { SWITCHABLE_SERVICES } from '../integrations/overview';
import { SOURCE_REASONS } from '../integrations/sources';

/**
 * A request to choose where one service runs. It carries the choice and nothing
 * else: `.strict()` turns a body that also tries to carry a key into a 400, so
 * this endpoint can never become a second way to write a secret.
 */
export const IntegrationSourceChangeSchema = z.object({
    service: z.enum(SWITCHABLE_SERVICES).describe('The service to change.'),
    source: z.enum(['provided', 'own']).describe('provided is Built-in; own is the company\'s own account.'),
}).strict().openapi('IntegrationSourceChange');

const SourceRowSchema = z.object({
    service: z.enum(SWITCHABLE_SERVICES),
    choiceShown: z.boolean().describe('Built-in exists for this service here, so the company is asked to choose.'),
    available: z.array(z.enum(['provided', 'own'])).describe('The sources the company can pick right now.'),
    stored: z.enum(['provided', 'own']).nullable().describe('The company\'s explicit choice, or null when it never made one.'),
    current: z.enum(['provided', 'own', 'unavailable']).describe('The source the service runs on now.'),
    reason: z.enum(SOURCE_REASONS).describe('Why the current source is what it is.'),
    reasonKey: z.enum([
        'integrations_source_reason_not_offered',
        'integrations_source_reason_provided_not_configured',
        'integrations_source_reason_own_credentials_incomplete',
        'integrations_source_reason_provider_confirmation_pending',
        'integrations_source_reason_dedicated_not_ready',
        'integrations_source_reason_dedicated_unavailable',
    ]).nullable().describe('Message key that explains an unavailable source, or null.'),
    state: z.enum(['connected', 'attention', 'not_connected']),
    dedicatedNumber: z.boolean().describe('The service runs on a number registered for the company.'),
    ownReady: z.boolean().describe('The company\'s own account details are complete. Keys themselves are never returned.'),
}).openapi('IntegrationSourceRow');

export const IntegrationSourcesResponseSchema = z.object({
    success: z.literal(true),
    data: z.array(SourceRowSchema),
}).openapi('IntegrationSourcesResponse');

export const IntegrationSourceSavedSchema = z.object({
    success: z.literal(true),
    data: z.object({
        service: z.enum(SWITCHABLE_SERVICES),
        source: z.enum(['provided', 'own']),
    }),
}).openapi('IntegrationSourceSaved');

export const IntegrationSourceRefusedSchema = z.object({
    success: z.literal(false),
    error: z.object({
        code: z.enum(['not_offered', 'own_credentials_incomplete']),
        message: z.string(),
    }),
}).openapi('IntegrationSourceRefused');
