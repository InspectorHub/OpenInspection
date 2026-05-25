import { z } from '@hono/zod-openapi';

export const CreateContactSchema = z.object({
    type: z.enum(['agent', 'client']).default('client').openapi({ example: 'agent' }).describe('TODO describe type field for the OpenInspection MCP integration'),
    name: z.string().min(1).max(100).openapi({ example: 'Jane Smith' }).describe('TODO describe name field for the OpenInspection MCP integration'),
    email: z.string().email().optional().nullable().openapi({ example: 'jane@realty.com' }).describe('TODO describe email field for the OpenInspection MCP integration'),
    phone: z.string().max(30).optional().nullable().openapi({ example: '(555) 987-6543' }).describe('TODO describe phone field for the OpenInspection MCP integration'),
    agency: z.string().max(100).optional().nullable().openapi({ example: 'Sunrise Realty' }).describe('TODO describe agency field for the OpenInspection MCP integration'),
    notes: z.string().max(500).optional().nullable().describe('TODO describe notes field for the OpenInspection MCP integration'),
}).openapi('CreateContact');

export const UpdateContactSchema = CreateContactSchema.partial().openapi('UpdateContact');

export const ContactResponseSchema = z.object({
    id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration'),
    tenantId: z.string().uuid().describe('TODO describe tenantId field for the OpenInspection MCP integration'),
    type: z.enum(['agent', 'client']).describe('TODO describe type field for the OpenInspection MCP integration'),
    name: z.string().describe('TODO describe name field for the OpenInspection MCP integration'),
    email: z.string().nullable().describe('TODO describe email field for the OpenInspection MCP integration'),
    phone: z.string().nullable().describe('TODO describe phone field for the OpenInspection MCP integration'),
    agency: z.string().nullable().describe('TODO describe agency field for the OpenInspection MCP integration'),
    notes: z.string().nullable().describe('TODO describe notes field for the OpenInspection MCP integration'),
    createdAt: z.string().describe('TODO describe createdAt field for the OpenInspection MCP integration'),
    inspectionCount: z.number().optional().describe('TODO describe inspectionCount field for the OpenInspection MCP integration'),
}).openapi('Contact');

export const ContactListQuerySchema = z.object({
    type: z.enum(['agent', 'client']).optional().openapi({ example: 'agent' }).describe('TODO describe type field for the OpenInspection MCP integration'),
    search: z.string().max(100).optional().describe('TODO describe search field for the OpenInspection MCP integration'),
    limit: z.coerce.number().min(1).max(200).default(50).describe('TODO describe limit field for the OpenInspection MCP integration'),
    offset: z.coerce.number().min(0).default(0).describe('TODO describe offset field for the OpenInspection MCP integration'),
}).openapi('ContactListQuery');
