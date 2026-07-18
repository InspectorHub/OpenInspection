import { z } from '@hono/zod-openapi';

/**
 * Display shape for a single OAuth grant returned by the grant-management API.
 * Used for both self-view (no user* fields) and admin-view (user* fields present).
 *
 * The `clientName` is sourced from the grant's metadata.clientName that was
 * stamped at authorization time by app/routes/oauth/authorize.tsx.
 */
const McpGrantSchema = z.object({
    id: z.string().describe('Unique grant identifier assigned by the OAuth provider'),
    clientId: z.string().describe('OAuth client identifier for the MCP client application'),
    clientName: z.string().nullable().describe('Human-readable display name of the MCP client, null when unset'),
    scopes: z.array(z.string()).describe('List of OAuth permission scopes granted to this MCP client'),
    createdAt: z.number().describe('Unix timestamp in seconds when this OAuth grant was created'),
    expiresAt: z.number().nullable().describe('Unix timestamp in seconds for grant expiry, null when permanent'),
    userId: z.string().optional().describe('User identifier who authorized this grant (admin view only)'),
    userEmail: z.string().optional().describe('Email address of user who authorized this grant (admin only)'),
    userRole: z.string().optional().describe('Role of the user who authorized this grant (admin view)'),
}).openapi('McpGrant');

export type McpGrant = z.infer<typeof McpGrantSchema>;

/**
 * Response body for list-grants endpoints.
 */
export const McpGrantListResponseSchema = z.object({
    data: z.array(McpGrantSchema).describe('List of OAuth grants matching the request scope'),
});
