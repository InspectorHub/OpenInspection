import { drizzle } from 'drizzle-orm/d1';
import { eq, and, isNull } from 'drizzle-orm';
import type { AppEnv } from '../../types/hono';
import type { McpProps } from '../../durable-objects/inspector-mcp';
import { buildKeyring, signJwt } from '../jwt-keyring';
import { users } from '../db/schema';

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

/** Spec §6 defense-in-depth: the company slug in the saas MCP URL
 * (/company/{slug}/mcp) MUST equal the slug baked into the OAuth grant.
 * A token issued for one company presented at another company's URL is
 * rejected here (tenant isolation also holds downstream via the
 * props.tenantId → internal JWT → ScopedDB chain; this fails loud at the edge). */
export function assertCompanySlugMatches(urlSlug: string, props: McpProps): boolean {
    return urlSlug === props.tenantSlug;
}

/** Extract the company slug from a saas MCP path: /company/{slug}/mcp → slug. Null if absent. */
export function companySlugFromMcpPath(pathname: string): string | null {
    const m = pathname.match(/^\/company\/([^/]+)\/mcp(?:\/|$)/);
    return m ? decodeURIComponent(m[1]) : null;
}

/**
 * Strip the `/company/{slug}` prefix from a saas MCP path so it matches the
 * McpAgent mount path: `/company/acme/mcp` → `/mcp`, `/company/acme/mcp/message`
 * → `/mcp/message`. McpAgent.serve('/mcp') matches the literal mount via
 * URLPattern, so the saas tenant-in-URL path must be reduced before delegating.
 * Paths without the prefix (standalone `/mcp`) are returned unchanged.
 */
export function stripCompanyPrefix(pathname: string): string {
    return pathname.replace(/^\/company\/[^/]+/, '');
}

/**
 * Defense-in-depth: is the grant's user still an active (non-removed) member
 * of the grant's tenant? Grant `props` are baked in once at authorize time and
 * never re-checked against the `users` row per MCP call — this narrows the
 * window between a removal/self-delete landing and the corresponding OAuth
 * grant revocation (team.service.ts removeMember / mcp/grants.ts) actually
 * completing, and also covers the case where that revocation itself fails.
 * The revocation is still the PRIMARY control — once a grant is gone, calls
 * with its access token are rejected before ctx.props is ever populated, so
 * this check never even runs for a fully-revoked grant.
 */
export async function isGrantUserActive(env: AppEnv, props: McpProps): Promise<boolean> {
    const db = drizzle(env.DB);
    const row = await db.select({ id: users.id }).from(users)
        .where(and(eq(users.id, props.userId), eq(users.tenantId, props.tenantId), isNull(users.deletedAt)))
        .get();
    return !!row;
}

/**
 * Calls the in-process API app on behalf of the authenticated MCP user.
 *
 * Steps:
 *  0. Verify the grant's user is still active (see isGrantUserActive) —
 *     fails closed with a 401 when the user was removed/self-deleted.
 *  1. Build the ES256 keyring from env.
 *  2. Sign an internal JWT from props claims.
 *  3. Clone the incoming request, injecting `Authorization: Bearer <jwt>`.
 *  4. Dispatch to the API app directly (no network hop).
 *
 * The dynamic import keeps the DO's top-level graph light — same rationale
 * as the lazy-import pattern in workers/app.ts.
 *
 * Testing: the pure helpers above (internalJwtPayload, assertCompanySlugMatches,
 * companySlugFromMcpPath) and isGrantUserActive are unit-tested (C3 / Fix 1).
 * The full buildKeyring → signJwt → app.fetch path in this function is NOT yet
 * exercised by any automated test — C4's workers test STUBS callApiAsUser to
 * assert tool-handler wiring, so the JWT-mint → in-process dispatch seam is
 * currently verified only by manual MCP-Inspector E2E. A seeded D1 + keyring +
 * Hono integration test that drives this path end-to-end is deferred (belongs
 * at the integration layer).
 */
export async function callApiAsUser(
    env: AppEnv,
    props: McpProps,
    request: Request,
    ctx: ExecutionContext,
): Promise<Response> {
    if (!(await isGrantUserActive(env, props))) {
        return new Response(JSON.stringify({ error: 'user_not_found' }), {
            status: 401,
            headers: { 'content-type': 'application/json' },
        });
    }

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
