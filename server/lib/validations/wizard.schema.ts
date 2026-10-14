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
        address:      z.string().min(3).max(300).describe('Street address of the property being inspected.'),
        yearBuilt:    z.number().int().min(1700).max(2100).optional().describe('Year the building was constructed; stored on the inspection when given.'),
        sqft:         z.number().int().min(100).max(50_000).optional().describe('Building floor area in square feet; stored on the inspection when given.'),
        propertyType: z.enum(['single_family', 'condo', 'townhouse', 'multi_family', 'commercial']).optional().describe('Kind of property, stored on the inspection when given.'),
        commercialSubtype: z.enum(['office', 'retail', 'hospitality', 'industrial', 'institutional', 'mixed-use']).optional().describe('Further classification of a commercial property. Applied only when propertyType is commercial and ignored otherwise.'),
    }).describe('Facts about the property being inspected.'),
    services: z.array(z.string().min(1).max(64)).min(1).max(20).describe('Services requested for this inspection, by identifier. Validated but not used to create anything on this route.'),
    schedule: z.object({
        date:            z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be ISO YYYY-MM-DD').describe('Calendar day of the inspection.'),
        startTime:       z.string().regex(/^\d{2}:\d{2}$/, 'startTime must be HH:MM').describe('Local start time on that day, appended to the date to form the inspection date.'),
        durationMinutes: z.number().int().min(30).max(720).describe('Expected length of the visit in minutes.'),
    }).describe('When the inspection takes place.'),
    teamMode:           z.boolean().describe('Whether the inspection is staffed by a team. When false, leadInspectorId and helperInspectorIds are ignored and the creator is the only assignee.'),
    leadInspectorId:    z.string().min(1).nullable().optional().describe('User id of the lead inspector in team mode; defaults to the signed-in user when omitted or null.'),
    helperInspectorIds: z.array(z.string().min(1)).max(20).optional().describe('User ids of helper inspectors assigned alongside the lead in team mode.'),
}).openapi('CreateInspectionFromWizard');

/**
 * @public — consumed via inline `import('...').CreateInspectionFromWizardInput`
 * type references in inspection.service.ts + inspection-core.service.ts, which
 * knip cannot trace (dynamic-import blind spot).
 */
export type CreateInspectionFromWizardInput = z.infer<typeof CreateInspectionFromWizardSchema>;
