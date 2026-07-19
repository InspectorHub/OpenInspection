import { z } from '@hono/zod-openapi';

/**
 * Spec 2 Task 6 — POST /{id}/send-report-pdf request contract. Generalizes
 * the manual report re-send from a single hardcoded `role:'client'` recipient
 * to an arbitrary set of role-keyed recipients, each getting their own
 * portal-access token/link. No frontend calls this endpoint yet (a later
 * task adds the "Send report" modal), so the contract is free to change.
 */
const SendReportRecipientSchema = z.object({
    contactId: z.string().min(1).optional().describe('Contact id of a person on the inspection; the endpoint resolves their email.'),
    email:     z.string().email().optional().describe('A one-off recipient email (used when no contactId is given).'),
    roleKey:   z.string().min(1).describe("The recipient's role-profile key (e.g. 'client', 'buyer_agent') — used to mint a role-keyed portal token."),
}).refine(r => !!r.contactId || !!r.email, { message: 'Each recipient needs a contactId or an email.' });

export const SendReportSchema = z.object({
    recipients: z.array(SendReportRecipientSchema).min(1).describe('One or more report recipients.'),
    channels:   z.array(z.enum(['email'])).min(1).default(['email']).describe('Delivery channels (email only for now).'),
}).openapi('SendReport');

/** A recipient the handler could not send to, and why. */
const SendReportSkippedSchema = z.object({
    recipient: z.string().describe('The contactId or email that identified the recipient in the request.'),
    reason:    z.string().describe('Why this recipient was skipped (no resolvable email, unknown roleKey, send failure, ...).'),
});

export const SendReportResponseDataSchema = z.object({
    sentTo:  z.array(z.string()).describe('Emails the report was actually sent to.'),
    skipped: z.array(SendReportSkippedSchema).optional().describe('Recipients that could not be sent to, with a reason each.'),
});
