import { z } from '@hono/zod-openapi';

/**
 * Communication A3.4 — POST /{id}/send-sms.
 *
 * Recipients MUST be people already on the inspection (contactId required).
 * Free-typed numbers are rejected: there is nowhere to record their consent,
 * so there is no honest way to gate them (design §3.5).
 */
const SendSmsRecipientSchema = z.object({
    contactId: z.string().min(1).describe('Contact id of a person seated on the inspection.'),
    roleKey:   z.string().min(1).describe("Their role-profile key on this inspection."),
});

export const SendSmsSchema = z.object({
    recipients: z.array(SendSmsRecipientSchema).min(1).describe('People on the inspection to text.'),
}).openapi('SendSms');

const SendSmsSkippedSchema = z.object({
    recipient: z.string().describe('contactId that identified the recipient.'),
    reason:    z.string().describe('Why this recipient was skipped or failed.'),
});

export const SendSmsResponseDataSchema = z.object({
    sentTo:  z.array(z.string()).describe('E.164 phones the SMS was actually sent to.'),
    skipped: z.array(SendSmsSkippedSchema).optional().describe('Recipients that could not be texted, with a reason each.'),
});
