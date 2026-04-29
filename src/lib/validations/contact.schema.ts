import { z } from '@hono/zod-openapi';

export const CreateContactSchema = z.object({
    type: z.enum(['agent', 'client']).default('client').openapi({ example: 'agent' }),
    name: z.string().min(1).max(100).openapi({ example: 'Jane Smith' }),
    email: z.string().email().optional().nullable().openapi({ example: 'jane@realty.com' }),
    phone: z.string().max(30).optional().nullable().openapi({ example: '(555) 987-6543' }),
    agency: z.string().max(100).optional().nullable().openapi({ example: 'Sunrise Realty' }),
    notes: z.string().max(500).optional().nullable(),
}).openapi('CreateContact');

export const UpdateContactSchema = CreateContactSchema.partial().openapi('UpdateContact');

export const ContactResponseSchema = z.object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    type: z.enum(['agent', 'client']),
    name: z.string(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    agency: z.string().nullable(),
    notes: z.string().nullable(),
    createdAt: z.string(),
    inspectionCount: z.number().optional(),
}).openapi('Contact');

export const ContactListQuerySchema = z.object({
    type: z.enum(['agent', 'client']).optional().openapi({ example: 'agent' }),
    search: z.string().max(100).optional(),
    limit: z.coerce.number().min(1).max(200).default(50),
    offset: z.coerce.number().min(0).default(0),
}).openapi('ContactListQuery');
