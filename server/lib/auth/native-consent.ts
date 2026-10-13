import type { AuthRequest, OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import { writeAuditLog } from '../audit';
import { NATIVE_SCOPE, type NativeProps } from './native-token';
import type { Role } from './roles';

/** True when the authorization request asks for the native client scope. */
export function isNativeAuthRequest(scope: readonly string[] | undefined): boolean {
  return (scope ?? []).includes(NATIVE_SCOPE);
}

export interface NativeConsentInput {
  oauth: OAuthHelpers;
  db: D1Database;
  authReq: AuthRequest;
  clientName: string;
  identity: { userId: string; tenantId: string; role: Role };
  ctx: Pick<ExecutionContext, 'waitUntil'> | undefined;
}

/**
 * Complete a native client's authorization after the user pressed Allow.
 *
 * The grant carries exactly the native scope and native props (no MCP module
 * scopes, whatever else the client asked for). The agent role has no access to
 * the app surface a native client opens, so it is refused before any grant
 * exists. Returns the redirect URL carrying the authorization code.
 */
export async function completeNativeAuthorization(input: NativeConsentInput): Promise<string> {
  const { oauth, db, authReq, clientName, identity, ctx } = input;
  if (identity.role === 'agent') throw new Response('Forbidden', { status: 403 });
  const props: NativeProps = {
    kind: 'native',
    userId: identity.userId,
    tenantId: identity.tenantId,
    role: identity.role,
    lastUsedAt: Math.floor(Date.now() / 1000),
  };
  const { redirectTo } = await oauth.completeAuthorization({
    request: authReq,
    userId: identity.userId,
    scope: [NATIVE_SCOPE],
    metadata: { clientName, kind: 'native' },
    props,
  });
  // Same shape and reasoning as mcp.grant.created: a React Router action has no
  // Hono context, so the tenant and actor are the identity already proven, and
  // waitUntil keeps the insert alive past the redirect response.
  writeAuditLog({
    db,
    tenantId: identity.tenantId,
    userId: identity.userId,
    action: 'native.grant.created',
    entityType: 'mcp_grant',
    metadata: { clientId: authReq.clientId },
    executionCtx: ctx,
  });
  return redirectTo;
}
