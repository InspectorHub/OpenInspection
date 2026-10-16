/**
 * Retained only so the already-deployed Durable Object class keeps resolving
 * until the migration that deletes it ships (see
 * docs/develop/conventions/mcp-migration-decisions.md). Nothing routes to it:
 * the MCP endpoint is now a stateless handler (server/lib/mcp/handler.ts) that
 * keeps no per-session state.
 *
 * `alarm()` is a no-op because instances created by the previous implementation
 * may still have an alarm set; without a handler the runtime would keep retrying
 * it and logging an error.
 */
export class InspectorMcp {
    constructor(_state: DurableObjectState, _env: unknown) {}

    fetch(): Response {
        return new Response('gone', { status: 410 });
    }

    alarm(): void {}
}
