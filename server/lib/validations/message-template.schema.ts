import { z } from '@hono/zod-openapi';

const ChannelSchema = z.enum(['email', 'sms']);

// tenantId is NEVER accepted from input (multi-tenant rule); .strip() drops extras.
export const CreateMessageTemplateSchema = z.object({
    name: z.string().min(1).max(200).describe('Display name for the template (max 200 chars).'),
    channel: ChannelSchema.describe('Delivery channel: email or sms.'),
    subject: z.string().max(500).nullish().describe('Email subject line (email channel only; max 500 chars).'),
    body: z.string().min(1).describe('Template body text; supports {{variable}} interpolation.'),
    variables: z.array(z.string()).optional().describe('Named interpolation variables used in the body.'),
}).strip();

export const UpdateMessageTemplateSchema = z.object({
    name: z.string().min(1).max(200).optional().describe('Updated display name (max 200 chars).'),
    subject: z.string().max(500).nullish().describe('Updated email subject line (email channel only).'),
    body: z.string().min(1).optional().describe('Updated template body; supports {{variable}} interpolation.'),
    variables: z.array(z.string()).optional().describe('Updated named interpolation variable list.'),
}).strip();

export const PreviewMessageTemplateSchema = z.object({
    channel: ChannelSchema.describe('Delivery channel for the preview: email or sms.'),
    subject: z.string().nullish().describe('Email subject line to render in the preview.'),
    body: z.string().min(1).describe('Template body to render; supports {{variable}} interpolation.'),
    sampleVars: z.record(z.string(), z.string()).optional().describe('Sample variable values for interpolation.'),
}).strip();

export const TestSendMessageTemplateSchema = z.object({
    channel: ChannelSchema.describe('Delivery channel for the test send: email or sms.'),
    subject: z.string().nullish().describe('Email subject line to send (email channel only).'),
    body: z.string().min(1).describe('Template body to send; supports {{variable}} interpolation.'),
    to: z.string().min(1).describe('Recipient email address or phone number for the test send.'),
    sampleVars: z.record(z.string(), z.string()).optional().describe('Sample variable values for interpolation.'),
}).strip();

export const MessageTemplateSchema = z.object({
    id: z.string(), tenantId: z.string(), name: z.string(),
    channel: ChannelSchema, subject: z.string().nullable(), body: z.string(),
    variables: z.array(z.string()), isSeeded: z.boolean(),
    createdAt: z.number(), updatedAt: z.number(),
});

export const MessageTemplateListResponseSchema = z.object({
    success: z.literal(true),
    data: z.array(MessageTemplateSchema),
});
