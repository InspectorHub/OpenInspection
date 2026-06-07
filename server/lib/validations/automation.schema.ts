import { z } from '@hono/zod-openapi';
import { createApiResponseSchema } from './shared.schema';

const AUTOMATION_TRIGGERS = [
    'inspection.created', 'inspection.confirmed', 'inspection.cancelled',
    'report.published', 'invoice.created', 'payment.received', 'agreement.signed',
    'agreement.signer_signed',
    'agreement.viewed', 'agreement.declined', 'agreement.expired',
    'event.created', 'event.completed',
] as const;

const AUTOMATION_RECIPIENTS = ['client', 'buying_agent', 'selling_agent', 'inspector', 'all'] as const;

export const AutomationSchema = z.object({
    id:              z.string().describe('TODO describe id field for the OpenInspection MCP integration'),
    tenantId:        z.string().describe('TODO describe tenantId field for the OpenInspection MCP integration'),
    name:            z.string().describe('TODO describe name field for the OpenInspection MCP integration'),
    trigger:         z.enum(AUTOMATION_TRIGGERS).describe('TODO describe trigger field for the OpenInspection MCP integration'),
    recipient:       z.enum(AUTOMATION_RECIPIENTS).describe('TODO describe recipient field for the OpenInspection MCP integration'),
    delayMinutes:    z.number().int().describe('TODO describe delayMinutes field for the OpenInspection MCP integration'),
    subjectTemplate: z.string().describe('TODO describe subjectTemplate field for the OpenInspection MCP integration'),
    bodyTemplate:    z.string().describe('TODO describe bodyTemplate field for the OpenInspection MCP integration'),
    active:          z.boolean().describe('TODO describe active field for the OpenInspection MCP integration'),
    isDefault:       z.boolean().describe('TODO describe isDefault field for the OpenInspection MCP integration'),
    createdAt:       z.string().nullable().describe('TODO describe createdAt field for the OpenInspection MCP integration'),
}).openapi('Automation');

export const CreateAutomationSchema = z.object({
    name:            z.string().min(1).max(200).describe('TODO describe name field for the OpenInspection MCP integration'),
    trigger:         z.enum(AUTOMATION_TRIGGERS).describe('TODO describe trigger field for the OpenInspection MCP integration'),
    recipient:       z.enum(AUTOMATION_RECIPIENTS).describe('TODO describe recipient field for the OpenInspection MCP integration'),
    delayMinutes:    z.number().int().min(0).default(0).describe('TODO describe delayMinutes field for the OpenInspection MCP integration'),
    subjectTemplate: z.string().min(1).describe('TODO describe subjectTemplate field for the OpenInspection MCP integration'),
    bodyTemplate:    z.string().min(1).describe('TODO describe bodyTemplate field for the OpenInspection MCP integration'),
}).openapi('CreateAutomation');

export const UpdateAutomationSchema = CreateAutomationSchema.partial().extend({
    active: z.boolean().optional().describe('TODO describe active field for the OpenInspection MCP integration'),
}).openapi('UpdateAutomation');

export const AutomationLogSchema = z.object({
    id:             z.string().describe('TODO describe id field for the OpenInspection MCP integration'),
    automationId:   z.string().describe('TODO describe automationId field for the OpenInspection MCP integration'),
    inspectionId:   z.string().describe('TODO describe inspectionId field for the OpenInspection MCP integration'),
    recipientEmail: z.string().describe('TODO describe recipientEmail field for the OpenInspection MCP integration'),
    sendAt:         z.string().describe('TODO describe sendAt field for the OpenInspection MCP integration'),
    deliveredAt:    z.string().nullable().describe('TODO describe deliveredAt field for the OpenInspection MCP integration'),
    status:         z.enum(['pending', 'sent', 'failed', 'skipped']).describe('TODO describe status field for the OpenInspection MCP integration'),
    error:          z.string().nullable().describe('TODO describe error field for the OpenInspection MCP integration'),
}).openapi('AutomationLog');

export const AutomationListResponseSchema = createApiResponseSchema(z.array(AutomationSchema));
export const AutomationLogListResponseSchema = createApiResponseSchema(z.array(AutomationLogSchema));
