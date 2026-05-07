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
        agentId: z.string().uuid(),
        reports: z.array(InspectionSchema),
    })
).openapi('AgentReportsResponse');

/**
 * Schema for the agent performance leaderboard.
 */
export const LeaderboardEntrySchema = z.object({
    agentId: z.string().uuid().nullable(),
    name:    z.string().nullable().optional(),
    agency:  z.string().nullable().optional(),
    email:   z.string().nullable().optional(),
    total:   z.number().openapi({ example: 42 }),
}).openapi('LeaderboardEntry');

export const LeaderboardResponseSchema = createApiResponseSchema(
    z.object({
        leaderboard: z.array(LeaderboardEntrySchema),
    })
).openapi('LeaderboardResponse');
