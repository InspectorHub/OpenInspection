import { z } from '@hono/zod-openapi';

/**
 * One card of the Integrations overview. `status` says whether the service
 * works; `source` says whose account it runs on. Two separate facts: a service
 * can be Built-in and not working, or Your own and working.
 */
const IntegrationCardSchema = z.object({
    id: z.string().describe('Stable id of the service, for example "email" or "quickbooks".'),
    category: z.enum(['payments', 'accounting', 'calendar', 'messaging', 'data', 'video', 'ai'])
        .describe('The group the card belongs to on the Integrations page.'),
    status: z.enum(['connected', 'attention', 'not_connected'])
        .describe('Whether the service is working, derived from stored settings and keys.'),
    source: z.enum(['provided', 'own', 'unavailable'])
        .describe('Whose account the service runs on: provided (Built-in), own (Your own), or unavailable when the wanted source cannot be used right now.'),
    dedicatedNumber: z.boolean()
        .describe('True when the service runs on a number registered for the company, which the page names Dedicated number.'),
    canUseOwn: z.boolean()
        .describe('True when the company can switch this service between Built-in and its own account.'),
    detailPath: z.string().describe('The settings page that manages the service.'),
    reasonKey: z.enum([
        'integrations_source_reason_not_offered',
        'integrations_source_reason_provided_not_configured',
        'integrations_source_reason_own_credentials_incomplete',
        'integrations_source_reason_provider_confirmation_pending',
        'integrations_source_reason_dedicated_not_ready',
    ]).nullable().describe('Message key that explains why the source is unavailable; null when nothing needs saying.'),
}).openapi('IntegrationCard');

export const IntegrationOverviewResponseSchema = z.object({
    success: z.literal(true),
    data: z.array(IntegrationCardSchema),
}).openapi('IntegrationOverviewResponse');
