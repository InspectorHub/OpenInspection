/**
 * GET /api/inspections/:id/communication — the Communication section's payload
 * (Communication design §2, plan A1.1/A1.2).
 *
 * Two arrays, deliberately NOT merged: **messages** (written by a person) and
 * **deliveries** (sent by the platform). The UI never interleaves them, so
 * merging server-side only to split again client-side invites the merged
 * rendering back.
 *
 * This endpoint superseded `GET /api/automations/logs/{inspectionId}` — a fully
 * defined route that never had a caller. Money redaction does not apply (no
 * money in this payload); recipient emails and phones DO go over the wire, and
 * the stated decision (design §6 Q3 pending) is that `requireRole` is the gate.
 */
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { requireRole } from '../../lib/middleware/rbac';
import { drizzle } from 'drizzle-orm/d1';
import { and, eq } from 'drizzle-orm';
import { inspections } from '../../lib/db/schema';
import { withMcpMetadata } from '../../lib/route-metadata-standards';

const DeliverySchema = z.object({
    id: z.string().describe('Log row id.'),
    direction: z.literal('out').describe('Deliveries are always outbound.'),
    channel: z.string().describe("Delivery channel ('email', 'sms', …). Render whatever arrives — new channels must not require a UI change."),
    recipient: z.string().describe('Email address or E.164 phone the notice went to.'),
    recipientContactId: z.string().nullable().describe('Contact the notice addressed; null for legacy rows and staff recipients.'),
    roleKey: z.string().nullable().describe("Recipient's role-profile key at enqueue time; raw, survives role deletion."),
    roleLabel: z.string().nullable().describe('Display label for the role; null when the role was deleted or deactivated — fall back to roleKey.'),
    status: z.enum(['pending', 'sent', 'failed', 'skipped']).describe('Delivery outcome.'),
    reasonCode: z.string().nullable().describe('RAW stored reason string for skipped/failed rows. The English mapping lives in the UI.'),
    source: z.enum(['automation', 'manual']).describe('What initiated the send.'),
    automationId: z.string().describe('Rule that fired. Grouping key component.'),
    automationName: z.string().nullable().describe('Rule name for the notice row title; null when the rule was deleted.'),
    sendAt: z.number().describe('Epoch-ms the firing was scheduled for. Grouping key component — one firing shares one sendAt.'),
    deliveredAt: z.number().nullable().describe('Epoch-ms of confirmed delivery, when known.'),
});

const MessageSchema = z.object({
    id: z.string().describe('Message id.'),
    direction: z.enum(['in', 'out']).describe("'out' when staff wrote it, 'in' when a counterparty did."),
    contactId: z.string().describe('The counterparty whose thread this message belongs to.'),
    fromRole: z.string().describe("Author's side: 'inspector' | 'client' | 'agent' | 'other'."),
    fromName: z.string().nullable().describe('Display name of the author.'),
    body: z.string().describe('Message text.'),
    attachments: z.array(z.object({
        id: z.string(), key: z.string(), name: z.string(), size: z.number(), type: z.string(), uploadedAt: z.number(),
    })).describe('Attached files.'),
    readAt: z.number().nullable().describe('Epoch-ms the counterparty side was marked read.'),
    createdAt: z.number().describe('Epoch-ms the message was written.'),
});

const communicationRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/{id}/communication',
    tags: ['inspections'],
    summary: "The inspection's Communication payload: person-written messages and platform-sent notices",
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({ id: z.string().min(1).describe('Inspection identifier.') }),
        query: z.object({
            markRead: z.enum(['1']).optional().describe('When set, marks every counterparty-authored message on the inspection read — the caller is DISPLAYING the merged Messages view, where all threads are visible at once. A poll refreshing a closed block must omit it.'),
        }),
    },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({
                success: z.literal(true),
                data: z.object({
                    messages: z.array(MessageSchema).describe('Person-written messages, every thread on this inspection, oldest first.'),
                    deliveries: z.array(DeliverySchema).describe('Platform-sent notices, newest firing first. Due rows only (send_at <= now).'),
                }),
            }) } },
            description: 'Communication payload',
        },
        404: { description: 'Inspection not found in this tenant' },
    },
    operationId: 'getInspectionCommunication',
    description: "Returns the inspection's communication in two never-interleaved arrays: messages (written by people — the client, agents, staff) and deliveries (sent by the platform — automation emails and SMS with their per-recipient outcome and raw skip/fail reason).",
}, { scopes: ['read'], tier: 'extended' }));

const communicationRoutes = createApiRouter()
    .openapi(communicationRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const { id } = c.req.valid('param');
        const { markRead } = c.req.valid('query');

        // 404 for another tenant's inspection BEFORE reading anything else.
        const owner = await drizzle(c.env.DB).select({ id: inspections.id })
            .from(inspections)
            .where(and(eq(inspections.id, id), eq(inspections.tenantId, tenantId)))
            .get();
        if (!owner) return c.json({ success: false, error: 'Inspection not found' }, 404);

        const [messages, deliveries] = await Promise.all([
            c.var.services.message.listForInspection(id, tenantId),
            c.var.services.automation.getCommunicationDeliveries(tenantId, id),
        ]);
        // After the read, so the rows still carry their unread state in THIS
        // response and the UI can style them; the next hub load sees zero.
        if (markRead) await c.var.services.message.markInspectionReadForStaff(id, tenantId);

        return c.json({
            success: true as const,
            data: {
                messages: messages.map((m: typeof messages[number]) => ({
                    id: m.id,
                    direction: (m.fromRole === 'inspector' ? 'out' : 'in') as 'in' | 'out',
                    contactId: m.contactId,
                    fromRole: m.fromRole,
                    fromName: m.fromName ?? null,
                    body: m.body,
                    attachments: m.attachments ?? [],
                    readAt: m.readAt == null ? null : (m.readAt instanceof Date ? m.readAt.getTime() : Number(m.readAt)),
                    createdAt: m.createdAt instanceof Date ? m.createdAt.getTime() : Number(m.createdAt),
                })),
                deliveries,
            },
        }, 200);
    });

export type CommunicationApi = typeof communicationRoutes;
export default communicationRoutes;
