import { z } from '@hono/zod-openapi';
import { createApiResponseSchema } from './shared.schema';

const AUTOMATION_TRIGGERS = [
    'inspection.created', 'inspection.confirmed', 'inspection.cancelled',
    'report.published', 'invoice.created', 'payment.received', 'agreement.signed',
] as const;

const AUTOMATION_RECIPIENTS = ['client', 'buying_agent', 'selling_agent', 'inspector', 'all'] as const;

export const AutomationSchema = z.object({
    id:              z.string(),
    tenantId:        z.string(),
    name:            z.string(),
    trigger:         z.enum(AUTOMATION_TRIGGERS),
    recipient:       z.enum(AUTOMATION_RECIPIENTS),
    delayMinutes:    z.number().int(),
    subjectTemplate: z.string(),
    bodyTemplate:    z.string(),
    active:          z.boolean(),
    isDefault:       z.boolean(),
    createdAt:       z.string().nullable(),
}).openapi('Automation');

export const CreateAutomationSchema = z.object({
    name:            z.string().min(1).max(200),
    trigger:         z.enum(AUTOMATION_TRIGGERS),
    recipient:       z.enum(AUTOMATION_RECIPIENTS),
    delayMinutes:    z.number().int().min(0).default(0),
    subjectTemplate: z.string().min(1),
    bodyTemplate:    z.string().min(1),
}).openapi('CreateAutomation');

export const UpdateAutomationSchema = CreateAutomationSchema.partial().extend({
    active: z.boolean().optional(),
}).openapi('UpdateAutomation');

export const AutomationLogSchema = z.object({
    id:             z.string(),
    automationId:   z.string(),
    inspectionId:   z.string(),
    recipientEmail: z.string(),
    sendAt:         z.string(),
    deliveredAt:    z.string().nullable(),
    status:         z.enum(['pending', 'sent', 'failed', 'skipped']),
    error:          z.string().nullable(),
}).openapi('AutomationLog');

export const AutomationListResponseSchema = createApiResponseSchema(z.array(AutomationSchema));
export const AutomationLogListResponseSchema = createApiResponseSchema(z.array(AutomationLogSchema));
