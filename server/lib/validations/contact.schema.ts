import { z } from '@hono/zod-openapi';
import { createApiResponseSchema } from './shared.schema';

export const CreateContactSchema = z.object({
    type: z.enum(['agent', 'client', 'other']).default('client').openapi({ example: 'agent' }).describe('TODO describe type field for the OpenInspection MCP integration'),
    name: z.string().min(1).max(100).openapi({ example: 'Jane Smith' }).describe('TODO describe name field for the OpenInspection MCP integration'),
    email: z.string().email().optional().nullable().openapi({ example: 'jane@realty.com' }).describe('TODO describe email field for the OpenInspection MCP integration'),
    phone: z.string().max(30).optional().nullable().openapi({ example: '(555) 987-6543' }).describe('TODO describe phone field for the OpenInspection MCP integration'),
    agency: z.string().max(100).optional().nullable().openapi({ example: 'Sunrise Realty' }).describe('TODO describe agency field for the OpenInspection MCP integration'),
    notes: z.string().max(500).optional().nullable().describe('TODO describe notes field for the OpenInspection MCP integration'),
    // The language this contact asked to be addressed in. NULL is an ABSENCE
    // of a stated preference, never English — see `contacts.locale` in the
    // schema for why that distinction is the point of the column.
    //
    // Deliberately NO `.default()`. `UpdateContactSchema` below is
    // `.partial()`, and `.partial()` KEEPS a default: a PATCH that never
    // mentions `locale` would then arrive carrying one, and the handler would
    // write it over a stored choice. Nullable so staff can put a contact back
    // to "not set" — a correction path needs a way back.
    //
    // A free BCP-47 tag rather than an enum, matching the booking payload; the
    // service reduces it to a locale we have messages for, or to NULL.
    locale: z.string().trim().min(2).max(35).optional().nullable().openapi({ example: 'es-419' }).describe("Contact's preferred language as a BCP-47 tag; reduced server-side to a supported locale, or stored as null when unsupported."),
}).openapi('CreateContact');

export const UpdateContactSchema = CreateContactSchema.partial().openapi('UpdateContact');

export const ContactResponseSchema = z.object({
    id: z.string().trim().min(1).describe('TODO describe id field for the OpenInspection MCP integration'),
    tenantId: z.string().trim().min(1).describe('TODO describe tenantId field for the OpenInspection MCP integration'),
    type: z.enum(['agent', 'client', 'other']).describe('TODO describe type field for the OpenInspection MCP integration'),
    name: z.string().describe('TODO describe name field for the OpenInspection MCP integration'),
    email: z.string().nullable().describe('TODO describe email field for the OpenInspection MCP integration'),
    phone: z.string().nullable().describe('TODO describe phone field for the OpenInspection MCP integration'),
    agency: z.string().nullable().describe('TODO describe agency field for the OpenInspection MCP integration'),
    notes: z.string().nullable().describe('TODO describe notes field for the OpenInspection MCP integration'),
    locale: z.string().nullable().describe("Contact's stated language preference (BCP-47), or null when they have not said."),
    createdAt: z.string().describe('TODO describe createdAt field for the OpenInspection MCP integration'),
    inspectionCount: z.number().optional().describe('TODO describe inspectionCount field for the OpenInspection MCP integration'),
    referralCount: z.number().optional().describe('Inspections where this contact is the tenant buyer_agent (referrals sent).'),
}).openapi('Contact');

export const ContactListQuerySchema = z.object({
    type: z.enum(['agent', 'client', 'other']).optional().openapi({ example: 'agent' }).describe('TODO describe type field for the OpenInspection MCP integration'),
    search: z.string().max(100).optional().describe('TODO describe search field for the OpenInspection MCP integration'),
    // IA-120 — archive had a writer and no reader. `archivedAt` was set by the
    // Archive button and then filtered out of every query, with no way to list,
    // open or restore the row: a one-way door behind a control whose own copy
    // ("Removes them from your list") promises tidying, not deletion.
    archived: z.enum(['exclude', 'only']).default('exclude')
        .describe('Whether to return live contacts (default) or the archived ones.'),
    limit: z.coerce.number().min(1).max(200).default(50).describe('TODO describe limit field for the OpenInspection MCP integration'),
    offset: z.coerce.number().min(0).default(0).describe('TODO describe offset field for the OpenInspection MCP integration'),
}).openapi('ContactListQuery');

// ─── IA-18 (#111) — contact detail page payload ─────────────────────────────
const ContactDetailSchema = z.object({
    contact: z.object({
        id:         z.string().describe('Contact id'),
        type:       z.enum(['agent', 'client', 'other']).describe('Contact type'),
        name:       z.string().describe('Contact name'),
        email:      z.string().nullable().describe('Contact email'),
        phone:      z.string().nullable().describe('Contact phone'),
        agency:     z.string().nullable().describe('Agency (agents only)'),
        notes:      z.string().nullable().describe('Free-text notes'),
        createdAt:  z.string().describe('ISO creation timestamp'),
        archivedAt: z.string().nullable().describe('ISO soft-delete timestamp, null when active'),
    }).describe('The contact record'),
    inspections: z.array(z.object({
        id:              z.string().describe('Inspection id'),
        propertyAddress: z.string().describe('Subject property address'),
        date:            z.string().describe('Scheduled date (YYYY-MM-DD)'),
        status:          z.string().describe('Inspection lifecycle status'),
        price:           z.number().describe('Denormalized price cache in cents'),
        paymentStatus:   z.string().describe('Payment status: unpaid | partial | paid'),
    })).describe('Inspection history for this contact, newest first'),
    stats: z.object({
        inspectionCount:   z.number().describe('Total linked inspections'),
        totalRevenueCents: z.number().describe('Sum of PAID invoice amounts in cents'),
    }).describe('Aggregate stats'),
}).openapi('ContactDetail');

export const ContactDetailResponseSchema = createApiResponseSchema(ContactDetailSchema).openapi('ContactDetailResponse');

// ─── CSV bulk import (preview + commit) ─────────────────────────────────────
export const ContactImportPreviewSchema = z.object({
    csv: z.string().min(1).max(2_000_000).describe('Raw CSV text, up to 2 MB'),
}).openapi('ContactImportPreview');

export const ContactImportPreviewResponseSchema = z.object({
    success: z.literal(true),
    data: z.object({
        columns: z.array(z.string()),
        rows: z.array(z.record(z.string(), z.string())),
        totalRowsDetected: z.number().int().min(0),
        truncated: z.boolean(),
    }),
}).openapi('ContactImportPreviewResponse');

export const ContactImportSchema = z.object({
    csv: z.string().min(1).max(2_000_000).describe('Raw CSV text to import, up to 2 MB'),
    mapping: z.object({
        name: z.string().describe('CSV column header mapped to contact name'),
        email: z.string().optional().describe('CSV column header mapped to email address'),
        phone: z.string().optional().describe('CSV column header mapped to phone number'),
        agency: z.string().optional().describe('CSV column header mapped to agency name'),
        type: z.enum(['agent', 'client', 'other']).optional().describe('Default contact type for imported rows'),
    }).describe('Column-to-field mapping confirmed by the user'),
}).openapi('ContactImport');

export const ContactImportResponseSchema = z.object({
    success: z.literal(true),
    data: z.object({
        inserted: z.number().int().min(0),
        skipped: z.number().int().min(0),
        errors: z.array(z.object({ row: z.number(), message: z.string() })),
    }),
}).openapi('ContactImportResponse');
