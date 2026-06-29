import type { AppEnv } from '../../types/hono';
import type { McpProps } from '../../durable-objects/inspector-mcp';
import { buildKeyring, signJwt } from '../jwt-keyring';

/**
 * Maps McpProps to the internal JWT claim set consumed by classifyJwtPayload.
 *
 * Claim keys are pinned to the values classifyJwtPayload reads:
 *   sub            ← userId
 *   custom:userRole ← role   (primary key; fallback 'role' not emitted)
 *   custom:tenantId ← tenantId
 *
 * signJwt auto-injects `iat` when absent; we set it here explicitly so the
 * pure return value is fully deterministic for tests.
 */
export function internalJwtPayload(props: McpProps): Record<string, unknown> {
    return {
        sub: props.userId,
        'custom:userRole': props.role,
        'custom:tenantId': props.tenantId,
        iat: Math.floor(Date.now() / 1000),
    };
}

/**
 * Guards against cross-tenant calls. Throws if the props tenant differs from
 * the tenant resolved from the URL / route (e.g. tenantSlug → tenantId
 * lookup). No-op on match.
 */
export function assertTenantMatches(expectedTenantId: string, props: McpProps): void {
    if (props.tenantId !== expectedTenantId) {
        throw new Error('tenant mismatch');
    }
}

/**
 * Calls the in-process API app on behalf of the authenticated MCP user.
 *
 * Steps:
 *  1. Build the ES256 keyring from env.
 *  2. Sign an internal JWT from props claims.
 *  3. Clone the incoming request, injecting `Authorization: Bearer <jwt>`.
 *  4. Dispatch to the API app directly (no network hop).
 *
 * The dynamic import keeps the DO's top-level graph light — same rationale
 * as the lazy-import pattern in workers/app.ts.
 *
 * Testing: the two pure helpers above (internalJwtPayload, assertTenantMatches)
 * are unit-tested (C3). The full buildKeyring → signJwt → app.fetch path in this
 * function is NOT yet exercised by any automated test — C4's workers test STUBS
 * callApiAsUser to assert tool-handler wiring, so the JWT-mint → in-process
 * dispatch seam is currently verified only by manual MCP-Inspector E2E. A seeded
 * D1 + keyring + Hono integration test that drives this path end-to-end is
 * deferred (belongs at the integration layer).
 */
export async function callApiAsUser(
    env: AppEnv,
    props: McpProps,
    request: Request,
    ctx: ExecutionContext,
): Promise<Response> {
    const keyring = await buildKeyring(env as never);
    const jwt = await signJwt(internalJwtPayload(props), keyring);

    // Clone the request, merging existing headers with the new Authorization
    // header. Do not mutate the original — the DO may reuse it.
    const merged = new Headers(request.headers);
    merged.set('Authorization', `Bearer ${jwt}`);
    const req = new Request(request, { headers: merged });

    const { app } = await import('../../index');
    return app.fetch(req, env, ctx);
}
