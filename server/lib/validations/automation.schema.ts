import { z } from '@hono/zod-openapi';
import { createApiResponseSchema } from './shared.schema';

const AUTOMATION_TRIGGERS = [
    'inspection.created', 'inspection.confirmed', 'inspection.cancelled',
    'report.published', 'invoice.created', 'payment.received', 'agreement.signed',
    'agreement.signer_signed',
    'agreement.viewed', 'agreement.declined', 'agreement.expired',
    'event.created', 'event.completed',
    'inspection.reminder',
] as const;

const AUTOMATION_RECIPIENTS = ['client', 'buying_agent', 'selling_agent', 'inspector', 'all'] as const;

const AUTOMATION_CHANNELS = ['email', 'sms'] as const;

// Track J (D2) — send-time gates. All optional; absent = no gate.
const ConditionsSchema = z.object({
    requirePaid:   z.boolean().optional().describe('Only send if the inspection payment_status is paid.'),
    requireSigned: z.boolean().optional().describe('Only send if the inspection has a signed agreement.'),
    serviceIds:    z.array(z.string()).optional().describe('Only send if the inspection booked one of these services; empty/absent = any.'),
}).strict();

export const AutomationSchema = z.object({
    id:              z.string().describe('TODO describe id field for the OpenInspection MCP integration'),
    tenantId:        z.string().describe('TODO describe tenantId field for the OpenInspection MCP integration'),
    name:            z.string().describe('TODO describe name field for the OpenInspection MCP integration'),
    trigger:         z.enum(AUTOMATION_TRIGGERS).describe('TODO describe trigger field for the OpenInspection MCP integration'),
    recipient:       z.enum(AUTOMATION_RECIPIENTS).describe('TODO describe recipient field for the OpenInspection MCP integration'),
    delayMinutes:    z.number().int().describe('TODO describe delayMinutes field for the OpenInspection MCP integration'),
    conditions:      z.string().nullable().describe('JSON-encoded send-time gates, or null. Editor parses it.'),
    // Track L (D2) — enabled delivery channels. Replaces the dead `channel` shadow column.
    channels:        z.array(z.enum(AUTOMATION_CHANNELS)).describe('Enabled delivery channels.'),
    // SP2 — template references; embedded body fields (subjectTemplate/bodyTemplate/smsBody) are dead and dropped.
    emailTemplateId: z.string().nullable().describe('Referenced email template id, or null.'),
    smsTemplateId:   z.string().nullable().describe('Referenced SMS template id, or null.'),
    active:          z.boolean().describe('TODO describe active field for the OpenInspection MCP integration'),
    isDefault:       z.boolean().describe('TODO describe isDefault field for the OpenInspection MCP integration'),
    createdAt:       z.string().nullable().describe('TODO describe createdAt field for the OpenInspection MCP integration'),
}).openapi('Automation');

const CreateAutomationBase = z.object({
    name:            z.string().min(1).max(200).describe('TODO describe name field for the OpenInspection MCP integration'),
    trigger:         z.enum(AUTOMATION_TRIGGERS).describe('TODO describe trigger field for the OpenInspection MCP integration'),
    recipient:       z.enum(AUTOMATION_RECIPIENTS).describe('TODO describe recipient field for the OpenInspection MCP integration'),
    // No `.default(0)` on the base — same `.partial()` injection hazard as `channels`: it would
    // reset a tenant's configured delay to 0 on every partial PATCH that omits it (the service
    // spreads `...rest` into the patch). Create re-adds the default below.
    delayMinutes:    z.number().int().min(0).describe('TODO describe delayMinutes field for the OpenInspection MCP integration'),
    conditions:      ConditionsSchema.nullish().describe('Send-time gates; null/omitted = none.'),
    // Track L (D2) — at least one delivery channel. NOTE: no `.default()` on the base field —
    // Zod's `.partial()` keeps the default and would inject `channels: ['email']` on every
    // partial PATCH that omits it, silently dropping a tenant's enabled SMS channel (the service
    // gates on key-presence via `'channels' in data`). Create adds the default; Update stays
    // omit-means-absent. See tests/unit/automation-schema.spec.ts.
    channels:        z.array(z.enum(AUTOMATION_CHANNELS)).min(1)
        .describe('At least one delivery channel.'),
    // SP2 — template ids replace embedded body fields. The delivery layer fail-closes when no
    // template is linked, so no refine is needed here (symmetry: email has no equivalent refine).
    emailTemplateId: z.string().nullish().describe('Id of the email message_template this automation sends (email channel); null = none.'),
    smsTemplateId:   z.string().nullish().describe('Id of the SMS message_template this automation sends (sms channel); null = none.'),
});

export const CreateAutomationSchema = CreateAutomationBase
    .extend({
        // Create-only defaults (kept off the base so `.partial()` doesn't inject them on Update).
        delayMinutes: z.number().int().min(0).default(0)
            .describe('TODO describe delayMinutes field for the OpenInspection MCP integration'),
        channels: z.array(z.enum(AUTOMATION_CHANNELS)).min(1).default(['email'])
            .describe('At least one delivery channel.'),
    })
    .openapi('CreateAutomation');

export const UpdateAutomationSchema = CreateAutomationBase.partial().extend({
    // Update-only: channels stays optional with NO default, so omitting it leaves the key
    // absent from parsed output and the service's key-presence gate never rewrites it.
    channels: z.array(z.enum(AUTOMATION_CHANNELS)).min(1).optional()
        .describe('At least one delivery channel.'),
    active: z.boolean().optional().describe('TODO describe active field for the OpenInspection MCP integration'),
}).openapi('UpdateAutomation');

const AutomationLogSchema = z.object({
    id:             z.string().describe('TODO describe id field for the OpenInspection MCP integration'),
    automationId:   z.string().describe('TODO describe automationId field for the OpenInspection MCP integration'),
    inspectionId:   z.string().describe('TODO describe inspectionId field for the OpenInspection MCP integration'),
    // Track L — email address for email logs, E.164 phone for sms logs.
    recipient:      z.string().describe('Delivery address: email for email logs, E.164 phone for sms logs.'),
    channel:        z.enum(AUTOMATION_CHANNELS).describe("This log's own delivery channel."),
    sendAt:         z.string().describe('TODO describe sendAt field for the OpenInspection MCP integration'),
    deliveredAt:    z.string().nullable().describe('TODO describe deliveredAt field for the OpenInspection MCP integration'),
    status:         z.enum(['pending', 'sent', 'failed', 'skipped']).describe('TODO describe status field for the OpenInspection MCP integration'),
    error:          z.string().nullable().describe('TODO describe error field for the OpenInspection MCP integration'),
}).openapi('AutomationLog');

export const AutomationListResponseSchema = createApiResponseSchema(z.array(AutomationSchema));
export const AutomationLogListResponseSchema = createApiResponseSchema(z.array(AutomationLogSchema));
