import { z } from '@hono/zod-openapi';
import { PublicBrandSchema } from './public-brand.schema';

const LineItemSchema = z.object({
    description: z.string().min(1).max(200).describe('TODO describe description field for the OpenInspection MCP integration'),
    amountCents: z.number().int().min(0).describe('TODO describe amountCents field for the OpenInspection MCP integration'),
});

export const CreateInvoiceSchema = z.object({
    inspectionId: z.string().trim().min(1).optional().nullable().describe('TODO describe inspectionId field for the OpenInspection MCP integration'),
    clientName: z.string().min(1).max(100).describe('TODO describe clientName field for the OpenInspection MCP integration'),
    clientEmail: z.string().email().optional().nullable().describe('TODO describe clientEmail field for the OpenInspection MCP integration'),
    amountCents: z.number().int().min(0).describe('TODO describe amountCents field for the OpenInspection MCP integration'),
    lineItems: z.array(LineItemSchema).default([]).describe('TODO describe lineItems field for the OpenInspection MCP integration'),
    dueDate: z.string().date().optional().nullable().openapi({ example: '2026-05-15' }).describe('TODO describe dueDate field for the OpenInspection MCP integration'),
    notes: z.string().max(500).optional().nullable().describe('TODO describe notes field for the OpenInspection MCP integration'),
}).openapi('CreateInvoice');

/**
 * Task 8 (Issue #111) — body for POST /api/invoices/request-payment. The hub
 * Invoice card "Request payment" button posts here; the endpoint resolves (or
 * creates) the inspection's invoice, marks it sent, and emails the client a pay
 * link. Tenant scope comes from the JWT, never the body.
 */
export const RequestPaymentSchema = z.object({
    inspectionId: z.string().trim().min(1).describe('Inspection whose invoice to send a payment request for'),
}).openapi('RequestPayment');

export const RequestPaymentResponseSchema = z.object({
    id: z.string().describe('Invoice row id'),
    status: z.enum(['draft', 'sent', 'partial', 'paid', 'void']).describe('Invoice status after the request (sent)'),
    amountCents: z.number().describe('Amount requested, in cents (money authority chain)'),
    sentAt: z.string().nullable().describe('ISO timestamp the request was marked sent'),
}).openapi('RequestPaymentResponse');

export const MarkInvoicePaidSchema = z.object({
    method: z.enum(['card', 'check', 'cash', 'offline', 'other']).optional()
        .describe('How the invoice was paid: card (online) or an offline method recorded by the inspector — check, cash, offline, or other.'),
}).openapi('MarkInvoicePaid');

export const InvoiceResponseSchema = z.object({
    id: z.string().trim().min(1).describe('TODO describe id field for the OpenInspection MCP integration'),
    tenantId: z.string().trim().min(1).describe('TODO describe tenantId field for the OpenInspection MCP integration'),
    inspectionId: z.string().trim().min(1).nullable().describe('TODO describe inspectionId field for the OpenInspection MCP integration'),
    clientName: z.string().nullable().describe('TODO describe clientName field for the OpenInspection MCP integration'),
    clientEmail: z.string().nullable().describe('TODO describe clientEmail field for the OpenInspection MCP integration'),
    amountCents: z.number().describe('TODO describe amountCents field for the OpenInspection MCP integration'),
    lineItems: z.array(LineItemSchema).describe('TODO describe lineItems field for the OpenInspection MCP integration'),
    dueDate: z.string().nullable().describe('TODO describe dueDate field for the OpenInspection MCP integration'),
    notes: z.string().nullable().describe('TODO describe notes field for the OpenInspection MCP integration'),
    sentAt: z.string().nullable().describe('TODO describe sentAt field for the OpenInspection MCP integration'),
    paidAt: z.string().nullable().describe('TODO describe paidAt field for the OpenInspection MCP integration'),
    createdAt: z.string().describe('TODO describe createdAt field for the OpenInspection MCP integration'),
    status: z.enum(['draft', 'sent', 'paid', 'partial', 'void']).describe('TODO describe status field for the OpenInspection MCP integration'),
    currency: z.string().describe('ISO 4217 currency this invoice was created in (snapshot from tenant at creation).'),
}).openapi('Invoice');

/**
 * Body of GET /api/public/inspections/:id/invoice — the token-gated public pay
 * page payload (standalone `/invoice/:id` and the Hub's `?section=payment`).
 *
 * The route wraps this in `.nullable()` (no invoice yet ⇒ null data). Kept here,
 * not inline in the route, because BOTH frontend callers derive their wire type
 * from it via `z.infer`, and `app/` imports from `server/lib/**` only — a
 * schema any client type depends on must not live in `server/api/**`.
 * Previously each caller hand-copied these fields and the copies drifted
 * (`tenantSlug` landed in one of them).
 */
export const PublicInvoiceBodySchema = z.object({
    id: z.string(),
    amountCents: z.number(),
    // Phase B — the invoice's snapshot currency (ISO 4217); the pay page renders
    // this, not the tenant's live setting, so history stays self-describing.
    currency: z.string().optional(),
    status: z.string(),
    createdAt: z.string().nullable().optional(),
    dueDate: z.string().nullable().optional(),
    clientName: z.string().nullable().optional(),
    // Deliberately NOT `LineItemSchema` — that one carries create-time input
    // constraints (min/max). This is an output shape; keep it unconstrained.
    lineItems: z.array(z.object({ description: z.string(), amountCents: z.number() })).optional(),
    brand: PublicBrandSchema.optional(),
    // IA-44 — the Hub route is slug-keyed (/portal/:tenant/i/:id) but this page
    // is not, so the payload carries the slug the post-payment hand-off needs.
    // Resolved from the GRANT's tenantId, never from anything the caller sent.
    tenantSlug: z.string().nullable().optional(),
});
