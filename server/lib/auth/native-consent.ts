import type { AuthRequest, OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import { writeAuditLog } from '../audit';
import { nativeClientEnabled } from '../mcp/flag';
import { logger } from '../logger';
import { NATIVE_SCOPE, claimsNative, isNativeRole, type NativeProps, type NativeRole } from './native-token';
import type { Role } from './roles';

/**
 * Most native grants one member keeps. Grants are not bound to a device, so a
 * lost phone or a reinstall leaves its grant behind; past this count the oldest
 * are revoked as a new one is made. Generous enough for several real devices.
 */
export const NATIVE_GRANTS_PER_USER_MAX = 10;

/** The native app is for owners, managers and inspectors; anyone else is refused. */
export function assertNativeRoleAllowed(role: string): asserts role is NativeRole {
  if (!isNativeRole(role)) throw new Response('Forbidden', { status: 403 });
}

/**
 * Keep a member's native grants at or under the cap by revoking the oldest.
 * Best effort: a provider failure is logged and never undoes the grant the
 * member just made. Only grants labelled native are counted or touched, so a
 * member's MCP grants are never swept up.
 */
async function trimNativeGrants(oauth: OAuthHelpers, userId: string): Promise<void> {
  try {
    const native: { id: string; createdAt: number }[] = [];
    let cursor: string | undefined;
    do {
      const page = await (cursor ? oauth.listUserGrants(userId, { cursor }) : oauth.listUserGrants(userId));
      for (const g of page.items) {
        if (claimsNative(g.metadata)) native.push({ id: g.id, createdAt: g.createdAt });
      }
      cursor = page.cursor;
    } while (cursor);
    const excess = native.length - NATIVE_GRANTS_PER_USER_MAX;
    if (excess <= 0) return;
    native.sort((a, b) => a.createdAt - b.createdAt);
    await Promise.all(native.slice(0, excess).map((g) => oauth.revokeGrant(g.id, userId)));
  } catch (err) {
    logger.warn('Failed to trim native grants; the member keeps more than the cap until the next sign-in', {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** True when the authorization request asks for the native client scope. */
export function isNativeAuthRequest(scope: readonly string[] | undefined): boolean {
  return (scope ?? []).includes(NATIVE_SCOPE);
}

/**
 * Where a native client's authorization code may be delivered (RFC 8252).
 *
 * `/oauth/register` is open, so the redirect URI is attacker-chosen and a native
 * grant is equivalent to a full session. Only two shapes can reach an app on the
 * user's own device: a private-use scheme in reverse-domain form (RFC 8252 7.1),
 * or an IP-literal loopback (7.3). The hostname `localhost`, https and any
 * remote http are refused.
 *
 * A private scheme must contain a dot. Every scheme a browser or the OS treats
 * as active content (javascript, data, file, vbscript, blob, ...) is dotless, so
 * this is stricter than a denylist and still admits `io.inspectorhub.app`.
 */
export function isNativeRedirectUri(uri: string): boolean {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.username || u.password) return false;
  if (u.protocol === 'http:') return u.hostname === '127.0.0.1' || u.hostname === '[::1]';
  if (u.protocol === 'https:') return false;
  return u.protocol.slice(0, -1).includes('.');
}

/**
 * A native authorization must carry a PKCE S256 challenge. The provider only
 * enforces PKCE when the request includes a challenge, and a private-use scheme
 * can be claimed by a second app on the same device, so without this a
 * look-alike app could take the code from the redirect and redeem it as a
 * public client. `allowPlainPKCE: false` already refuses `plain` at parse time;
 * this refuses the absence of PKCE.
 */
export function hasNativePkce(authReq: Pick<AuthRequest, 'codeChallenge' | 'codeChallengeMethod'>): boolean {
  return !!authReq.codeChallenge && authReq.codeChallengeMethod === 'S256';
}

/**
 * What the consent page may say about where the app will be opened: the
 * private-use scheme, or "this computer" for a loopback redirect. Never the full
 * URL: the path and query carry nothing the user can judge.
 */
export function nativeRedirectDisplay(uri: string): { loopback: boolean; scheme: string } {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return { loopback: false, scheme: '' };
  }
  if (u.protocol === 'http:') return { loopback: true, scheme: '' };
  return { loopback: false, scheme: u.protocol.slice(0, -1) };
}

export interface NativeConsentInput {
  env: { NATIVE_CLIENT_ENABLED?: string };
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
  const { env, oauth, db, authReq, clientName, identity, ctx } = input;
  // Fail closed: the OAuth provider is also mounted for MCP alone, and a native
  // grant must not be obtainable on a deployment that never opted in.
  if (!nativeClientEnabled(env)) throw new Response('Not Found', { status: 404 });
  if (!isNativeRedirectUri(authReq.redirectUri)) throw new Response('Bad Request', { status: 400 });
  if (!hasNativePkce(authReq)) throw new Response('Bad Request', { status: 400 });
  assertNativeRoleAllowed(identity.role);
  const nowSec = Math.floor(Date.now() / 1000);
  const props: NativeProps = {
    kind: 'native',
    userId: identity.userId,
    tenantId: identity.tenantId,
    role: identity.role,
    lastUsedAt: nowSec,
    grantedAt: nowSec,
  };
  const { redirectTo } = await oauth.completeAuthorization({
    request: authReq,
    userId: identity.userId,
    scope: [NATIVE_SCOPE],
    metadata: { clientName, kind: 'native' },
    props,
    // Grants are not bound to a device. The default would revoke the member's
    // older grant for the same client_id, so a second phone signing in under a
    // shared client_id would sign the first one out.
    revokeExistingGrants: false,
  });
  await trimNativeGrants(oauth, identity.userId);
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
