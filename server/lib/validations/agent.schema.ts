import { z } from '@hono/zod-openapi';
import { createApiResponseSchema } from './shared.schema';
import { InspectionSchema } from './inspection.schema';

/**
 * Schema for an individual agent's reports query.
 */
export const AgentReportsQuerySchema = z.object({
    agentId: z.string().uuid().optional().openapi({ 
        description: 'Optional agent ID to filter by. Defaults to the current user if not provided.' 
    }),
}).openapi('AgentReportsQuery');

/**
 * Schema for an agent's referral report list response.
 */
export const AgentReportsResponseSchema = createApiResponseSchema(
    z.object({
        agentId: z.string().uuid().describe('TODO describe agentId field for the OpenInspection MCP integration'),
        reports: z.array(InspectionSchema).describe('TODO describe reports field for the OpenInspection MCP integration'),
    })
).openapi('AgentReportsResponse');

/**
 * Schema for the agent performance leaderboard.
 */
const LeaderboardEntrySchema = z.object({
    agentId: z.string().uuid().nullable().describe('TODO describe agentId field for the OpenInspection MCP integration'),
    name:    z.string().nullable().optional().describe('TODO describe name field for the OpenInspection MCP integration'),
    agency:  z.string().nullable().optional().describe('TODO describe agency field for the OpenInspection MCP integration'),
    email:   z.string().nullable().optional().describe('TODO describe email field for the OpenInspection MCP integration'),
    total:   z.number().openapi({ example: 42 }).describe('TODO describe total field for the OpenInspection MCP integration'),
}).openapi('LeaderboardEntry');

export const LeaderboardResponseSchema = createApiResponseSchema(
    z.object({
        leaderboard: z.array(LeaderboardEntrySchema).describe('TODO describe leaderboard field for the OpenInspection MCP integration'),
    })
).openapi('LeaderboardResponse');

// Agent Accounts A2 — POST /api/agent/profile body. All fields optional;
// caller sends only the field(s) they want to update.
export const AgentProfilePatchSchema = z.object({
    slug:             z.string().min(3).max(32).regex(/^[a-z0-9][a-z0-9-]+[a-z0-9]$/).optional().describe('TODO describe slug field for the OpenInspection MCP integration'),
    name:             z.string().min(1).max(120).optional().describe('TODO describe name field for the OpenInspection MCP integration'),
    notifyOnReferral: z.boolean().optional().describe('TODO describe notifyOnReferral field for the OpenInspection MCP integration'),
    notifyOnReport:   z.boolean().optional().describe('TODO describe notifyOnReport field for the OpenInspection MCP integration'),
    notifyOnPaid:     z.boolean().optional().describe('TODO describe notifyOnPaid field for the OpenInspection MCP integration'),
    // Personal display-timezone override (IANA id). Empty string clears it, so
    // referral dates fall back to each inspecting company's timezone. Validated
    // against the runtime Intl database in the service (isValidTimeZone).
    timezone:         z.string().max(64).optional().describe('Personal display timezone (IANA id); empty string clears the override.'),
}).openapi('AgentProfilePatch');

export const AgentProfilePatchResponseSchema = createApiResponseSchema(
    z.object({
        ok: z.literal(true).describe('TODO describe ok field for the OpenInspection MCP integration'),
    }),
).openapi('AgentProfilePatchResponse');

// Spec 3 Task 4b — GET /api/agent/profile response. Mirrors the shape
// getProfile() returns: current slug + notification prefs for the signed-in
// agent, seeding the settings-profile page's loader.
export const AgentProfileResponseSchema = createApiResponseSchema(
    z.object({
        name:             z.string().nullable().describe('TODO describe name field for the OpenInspection MCP integration'),
        email:            z.string().describe('TODO describe email field for the OpenInspection MCP integration'),
        slug:             z.string().nullable().describe('TODO describe slug field for the OpenInspection MCP integration'),
        notifyOnReferral: z.boolean().describe('TODO describe notifyOnReferral field for the OpenInspection MCP integration'),
        notifyOnReport:   z.boolean().describe('TODO describe notifyOnReport field for the OpenInspection MCP integration'),
        notifyOnPaid:     z.boolean().describe('TODO describe notifyOnPaid field for the OpenInspection MCP integration'),
        timezone:         z.string().nullable().describe('Personal display timezone (IANA id), or null to use each company timezone.'),
    }),
).openapi('AgentProfileResponse');

// Agent Accounts A3 — POST /api/agent/concierge-book body. Agent submits a
// booking on behalf of a client. Server resolves the agent ↔ tenant link,
// creates a draft inspection, and either mints a magic-link token to email
// the client (default mode) or notifies the inspector for review (per-tenant
// reviewer mode).
export const ConciergeBookSchema = z.object({
    tenantId:           z.string().uuid().describe('TODO describe tenantId field for the OpenInspection MCP integration'),
    inspectorContactId: z.string().min(1).describe('TODO describe inspectorContactId field for the OpenInspection MCP integration'),
    date:               z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'Date must be ISO YYYY-MM-DD').describe('TODO describe date field for the OpenInspection MCP integration'),
    timeSlot:           z.string().min(1).max(20).describe('TODO describe timeSlot field for the OpenInspection MCP integration'),
    propertyAddress:    z.string().min(3).max(500).describe('TODO describe propertyAddress field for the OpenInspection MCP integration'),
    clientName:         z.string().min(1).max(200).describe('TODO describe clientName field for the OpenInspection MCP integration'),
    clientEmail:        z.string().email().describe('TODO describe clientEmail field for the OpenInspection MCP integration'),
    clientPhone:        z.string().max(40).optional().describe('TODO describe clientPhone field for the OpenInspection MCP integration'),
    agreementRequired:  z.boolean().default(true).describe('TODO describe agreementRequired field for the OpenInspection MCP integration'),
    paymentRequired:    z.boolean().default(false).describe('TODO describe paymentRequired field for the OpenInspection MCP integration'),
}).openapi('ConciergeBook');

export const ConciergeBookResponseSchema = createApiResponseSchema(
    z.object({
        inspectionId: z.string().uuid().describe('TODO describe inspectionId field for the OpenInspection MCP integration'),
        status:       z.enum(['awaiting_inspector', 'awaiting_client']).describe('TODO describe status field for the OpenInspection MCP integration'),
    }),
).openapi('ConciergeBookResponse');

// UC-A-5 — row shape for GET /api/agent/my-recommendations (agent's flattened
// recommendations grouped by safety/recommendation/maintenance). Relocated
// from server/api/agent.ts (file-size ratchet) alongside this module's other
// route-response schemas.
const RecommendationRowSchema = z.object({
    inspectionId:    z.string().describe('TODO describe inspectionId field for the OpenInspection MCP integration'),
    propertyAddress: z.string().describe('TODO describe propertyAddress field for the OpenInspection MCP integration'),
    inspectionDate:  z.string().describe('TODO describe inspectionDate field for the OpenInspection MCP integration'),
    sectionTitle:    z.string().describe('TODO describe sectionTitle field for the OpenInspection MCP integration'),
    itemLabel:       z.string().describe('TODO describe itemLabel field for the OpenInspection MCP integration'),
    defectTitle:     z.string().describe('TODO describe defectTitle field for the OpenInspection MCP integration'),
    // Widened (Authoring unification Plan-4 module K): a defect_categories.id
    // or legacy seed name. This feed still only groups into the 3 fixed
    // legacy buckets below (agent-recommendations.ts), so in practice the
    // value here is always one of those three.
    category:        z.string().describe('Defect category — a defect_categories.id or legacy seed name (safety/recommendation/maintenance).'),
    comment:         z.string().describe('TODO describe comment field for the OpenInspection MCP integration'),
    location:        z.string().nullable().describe('TODO describe location field for the OpenInspection MCP integration'),
    photos:          z.array(z.string()).describe('TODO describe photos field for the OpenInspection MCP integration'),
});

// UC-A-5 — GET /api/agent/my-recommendations response envelope.
export const AgentMyRecommendationsResponseSchema = z.object({
    success: z.boolean().describe('TODO describe success field for the OpenInspection MCP integration'),
    data: z.object({
        safety:         z.array(RecommendationRowSchema).describe('TODO describe safety field for the OpenInspection MCP integration'),
        recommendation: z.array(RecommendationRowSchema).describe('TODO describe recommendation field for the OpenInspection MCP integration'),
        maintenance:    z.array(RecommendationRowSchema).describe('TODO describe maintenance field for the OpenInspection MCP integration'),
    }).describe('TODO describe data field for the OpenInspection MCP integration'),
});

// C-10 ③-C — row shape for GET /api/agent/referrals.
export const AgentReferralRowSchema = z.object({
    id:              z.string().describe('Inspection id.'),
    tenantName:      z.string().describe('Inspecting company name.'),
    tenantSlug:      z.string().describe('Tenant slug for building repair-builder links.'),
    tenantTimezone:  z.string().describe("Owning tenant's display timezone from tenant_configs (IANA; 'UTC' when unset)."),
    propertyAddress: z.string().nullable().describe('Property address of the referred inspection.'),
    clientName:      z.string().nullable().describe('Client (buyer) name on the referral.'),
    date:            z.string().nullable().describe('Scheduled inspection date.'),
    status:          z.string().describe('Inspection lifecycle status.'),
    reportStatus:    z.string().nullable().describe('Report lifecycle status (published = repair builder available).'),
    inspectorName:   z.string().nullable().describe('Assigned inspector name.'),
});

// C-10 ③-C — row shape for GET /api/agent/inspectors.
export const AgentInspectorRowSchema = z.object({
    inspectorName:     z.string().nullable().describe('Inspector display name.'),
    inspectorSlug:     z.string().nullable().describe('Inspector public profile slug.'),
    inspectorPhotoUrl: z.string().nullable().describe('Inspector avatar URL.'),
    tenantName:        z.string().describe('Inspecting company name.'),
    tenantSlug:   z.string().describe('Tenant slug for the booking link.'),
});
