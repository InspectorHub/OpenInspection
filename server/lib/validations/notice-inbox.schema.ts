import { z } from '@hono/zod-openapi';

/**
 * Track C3 — the outward Notices inbox payload, shared by the client portal
 * (one company) and the agent portal (across companies). One shape for both:
 * after C1 a notice is a notice regardless of who reads it, and the audience
 * difference lives in the ENTRY POINT, not the record.
 *
 * What is deliberately NOT here: any other recipient's address. The header is
 * per-recipient (design §3.13), so `recipient` below is always the reader's
 * own — scope by construction rather than by filtering.
 */

export const NoticeChannelSchema = z.object({
    channel: z.string().describe('Delivery channel for this attempt (email, sms, ...).'),
    status: z.enum(['pending', 'sent', 'failed', 'skipped']).describe('Outcome of this one channel attempt.'),
    reasonCode: z.string().nullable().describe('Raw stored reason for a skip/failure; the reader-facing wording is mapped in the UI (operator and client maps differ deliberately).'),
    recipient: z.string().describe("The reader's OWN address for this channel (email address or E.164 phone)."),
    deliveredAt: z.number().nullable().describe('Epoch ms the provider confirmed delivery, or null.'),
    sendAt: z.number().describe('Epoch ms the attempt was enqueued for.'),
});

export const NoticeRowSchema = z.object({
    id: z.string().describe('Notice header id.'),
    tenantId: z.string().describe('Company this notice came from (an agent inbox spans several).'),
    type: z.string().describe('The event that produced the notice (report.published, ...).'),
    title: z.string().describe('Notice title.'),
    body: z.string().nullable().describe('Optional notice body.'),
    inspectionId: z.string().nullable().describe('The inspection this notice concerns, when it concerns one.'),
    companyName: z.string().nullable().describe('Sending company display name; rendered by the agent inbox, which spans companies.'),
    createdAt: z.number().describe('Epoch ms the notice was created.'),
    readAt: z.number().nullable().describe('Epoch ms the recipient read it, or null when unread.'),
    channels: z.array(NoticeChannelSchema).describe('Per-channel delivery attempts belonging to this notice.'),
});

export const NoticeListResponseSchema = z.object({
    success: z.literal(true).describe('Always true on a 200.'),
    data: z.object({
        notices: z.array(NoticeRowSchema).describe("Notices addressed to the caller, newest first."),
        unread: z.number().describe('Count of unread, non-archived notices for the caller.'),
    }).describe('The caller-scoped inbox.'),
});

export const NoticeMarkReadSchema = z.object({
    ids: z.array(z.string().min(1)).max(200).optional()
        .describe('Notice ids to mark read. Omit to mark every unread notice read.'),
});

export const NoticeOkResponseSchema = z.object({
    success: z.literal(true).describe('Always true on a 200.'),
    data: z.object({ ok: z.literal(true).describe('The write was applied (idempotent).') }).describe('Write acknowledgement.'),
});
