import { z } from '@hono/zod-openapi';

const LineItemSchema = z.object({
    description: z.string().min(1).max(200).describe('TODO describe description field for the OpenInspection MCP integration'),
    amountCents: z.number().int().min(0).describe('TODO describe amountCents field for the OpenInspection MCP integration'),
});

export const CreateInvoiceSchema = z.object({
    inspectionId: z.string().uuid().optional().nullable().describe('TODO describe inspectionId field for the OpenInspection MCP integration'),
    clientName: z.string().min(1).max(100).describe('TODO describe clientName field for the OpenInspection MCP integration'),
    clientEmail: z.string().email().optional().nullable().describe('TODO describe clientEmail field for the OpenInspection MCP integration'),
    amountCents: z.number().int().min(0).describe('TODO describe amountCents field for the OpenInspection MCP integration'),
    lineItems: z.array(LineItemSchema).default([]).describe('TODO describe lineItems field for the OpenInspection MCP integration'),
    dueDate: z.string().date().optional().nullable().openapi({ example: '2026-05-15' }).describe('TODO describe dueDate field for the OpenInspection MCP integration'),
    notes: z.string().max(500).optional().nullable().describe('TODO describe notes field for the OpenInspection MCP integration'),
}).openapi('CreateInvoice');

export const UpdateInvoiceSchema = CreateInvoiceSchema.partial().openapi('UpdateInvoice');

/**
 * Task 8 (Issue #111) — body for POST /api/invoices/request-payment. The hub
 * Invoice card "Request payment" button posts here; the endpoint resolves (or
 * creates) the inspection's invoice, marks it sent, and emails the client a pay
 * link. Tenant scope comes from the JWT, never the body.
 */
export const RequestPaymentSchema = z.object({
    inspectionId: z.string().uuid().describe('Inspection whose invoice to send a payment request for'),
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
    id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration'),
    tenantId: z.string().uuid().describe('TODO describe tenantId field for the OpenInspection MCP integration'),
    inspectionId: z.string().uuid().nullable().describe('TODO describe inspectionId field for the OpenInspection MCP integration'),
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
}).openapi('Invoice');
