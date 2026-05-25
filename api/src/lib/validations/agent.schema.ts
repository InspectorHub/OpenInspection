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
export const LeaderboardEntrySchema = z.object({
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
}).openapi('AgentProfilePatch');

export const AgentProfilePatchResponseSchema = createApiResponseSchema(
    z.object({
        ok: z.literal(true).describe('TODO describe ok field for the OpenInspection MCP integration'),
    }),
).openapi('AgentProfilePatchResponse');

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
