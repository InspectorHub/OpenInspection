// Remote MCP server Durable Object. Tool registration is added in Phase C.
import { McpAgent } from 'agents/mcp';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// `Env` is the global interface from worker-configuration.d.ts (extends Cloudflare.Env),
// which satisfies McpAgent's `Env extends Cloudflare.Env` constraint.
// AppEnv is the hand-maintained subset used by Hono routes and other DOs; it does not
// declare every wrangler `vars` entry so cannot be used as the McpAgent Env generic.

/**
 * OAuth grant props encrypted into every access token and passed to this DO
 * as `this.props` on each authenticated request. Later tasks (A3, C4) read
 * these for tenant scoping and tool authorization — do not rename fields.
 */
export interface McpProps extends Record<string, unknown> {
    userId:     string;
    tenantId:   string;
    tenantSlug: string;
    role:       string;
    /** e.g. ['read:inspections', 'write:bookings'] */
    scopes:     string[];
}

export class InspectorMcp extends McpAgent<Env, unknown, McpProps> {
    server = new McpServer({ name: 'OpenInspection', version: '1.0.0' });

    async init(): Promise<void> {
        // Tools registered in Phase C (Task C4).
    }
}
