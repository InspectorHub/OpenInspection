// Design System 0520 subsystem B phase 5 — NewInspectionWizard payload.
//
// Replaces the single-step "New Inspection" modal with a 4-step flow:
//   1. Property — address + year built + sqft + property type
//   2. Services — at least one inspection service
//   3. Schedule — date + start time + duration (minutes)
//   4. Team    — visible only when teamMode === true; picks lead + helpers
//
// POST /api/inspections/wizard — sibling to the legacy POST /api/inspections
// so existing callers (templates page, agent submissions) keep working
// unchanged. Created inspection redirects the wizard to /inspections/:id/edit.
import { z } from '@hono/zod-openapi';

export const CreateInspectionFromWizardSchema = z.object({
    property: z.object({
        address:      z.string().min(3).max(300).describe('TODO describe address field for the OpenInspection MCP integration'),
        yearBuilt:    z.number().int().min(1700).max(2100).optional().describe('TODO describe yearBuilt field for the OpenInspection MCP integration'),
        sqft:         z.number().int().min(100).max(50_000).optional().describe('TODO describe sqft field for the OpenInspection MCP integration'),
        propertyType: z.enum(['single_family', 'condo', 'townhouse', 'multi_family', 'commercial']).optional().describe('TODO describe propertyType field for the OpenInspection MCP integration'),
        commercialSubtype: z.enum(['office', 'retail', 'hospitality', 'industrial', 'institutional', 'mixed-use']).optional().describe('TODO describe commercialSubtype field for the OpenInspection MCP integration'),
    }).describe('TODO describe property field for the OpenInspection MCP integration'),
    services: z.array(z.string().min(1).max(64)).min(1).max(20).describe('TODO describe services field for the OpenInspection MCP integration'),
    schedule: z.object({
        date:            z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be ISO YYYY-MM-DD').describe('TODO describe date field for the OpenInspection MCP integration'),
        startTime:       z.string().regex(/^\d{2}:\d{2}$/, 'startTime must be HH:MM').describe('TODO describe startTime field for the OpenInspection MCP integration'),
        durationMinutes: z.number().int().min(30).max(720).describe('TODO describe durationMinutes field for the OpenInspection MCP integration'),
    }).describe('TODO describe schedule field for the OpenInspection MCP integration'),
    teamMode:           z.boolean().describe('TODO describe teamMode field for the OpenInspection MCP integration'),
    leadInspectorId:    z.string().min(1).nullable().optional().describe('TODO describe leadInspectorId field for the OpenInspection MCP integration'),
    helperInspectorIds: z.array(z.string().min(1)).max(20).optional().describe('TODO describe helperInspectorIds field for the OpenInspection MCP integration'),
}).openapi('CreateInspectionFromWizard');

export type CreateInspectionFromWizardInput = z.infer<typeof CreateInspectionFromWizardSchema>;
