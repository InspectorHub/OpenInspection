import { z } from '@hono/zod-openapi';

const LineItemSchema = z.object({
    description: z.string().min(1).max(200),
    amountCents: z.number().int().min(0),
});

export const CreateInvoiceSchema = z.object({
    inspectionId: z.string().uuid().optional().nullable(),
    clientName: z.string().min(1).max(100),
    clientEmail: z.string().email().optional().nullable(),
    amountCents: z.number().int().min(0),
    lineItems: z.array(LineItemSchema).default([]),
    dueDate: z.string().date().optional().nullable().openapi({ example: '2026-05-15' }),
    notes: z.string().max(500).optional().nullable(),
}).openapi('CreateInvoice');

export const UpdateInvoiceSchema = CreateInvoiceSchema.partial().openapi('UpdateInvoice');

export const InvoiceResponseSchema = z.object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    inspectionId: z.string().uuid().nullable(),
    clientName: z.string().nullable(),
    clientEmail: z.string().nullable(),
    amountCents: z.number(),
    lineItems: z.array(LineItemSchema),
    dueDate: z.string().nullable(),
    notes: z.string().nullable(),
    sentAt: z.string().nullable(),
    paidAt: z.string().nullable(),
    createdAt: z.string(),
    status: z.enum(['draft', 'sent', 'paid']),
}).openapi('Invoice');
