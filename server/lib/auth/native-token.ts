import { drizzle } from 'drizzle-orm/d1';
import { and, eq, isNull } from 'drizzle-orm';
import { users } from '../db/schema';

/** The scope a native client requests and the consent page grants. */
export const NATIVE_SCOPE = 'native';

const NATIVE_ROLES = ['owner', 'manager', 'inspector'] as const;
type NativeRole = (typeof NATIVE_ROLES)[number];

/** Grant props written by the consent page for a native client. */
export interface NativeProps {
  kind: 'native';
  userId: string;
  tenantId: string;
  role: NativeRole;
  /** Epoch seconds of the last successful token exchange; drives the sliding idle limit. */
  lastUsedAt: number;
}

/**
 * The slice of the OAuth provider's helpers this module reads. Declared
 * structurally so the real `OAuthHelpers` satisfies it and a test double does
 * not have to fabricate the rest of the surface.
 */
export interface TokenUnwrapper {
  unwrapToken(token: string): Promise<{
    /** The access token's own scope; an RFC 8693 exchange can narrow it below the grant's. */
    scope: string[];
    grant: { scope: string[]; props: unknown };
  } | null>;
}

export interface NativeTokenEnv {
  DB: D1Database;
  OAUTH_PROVIDER?: TokenUnwrapper;
}

function isNativeRole(role: string): role is NativeRole {
  return (NATIVE_ROLES as readonly string[]).includes(role);
}

export function isNativeProps(p: unknown): p is NativeProps {
  if (!p || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  return o.kind === 'native'
    && typeof o.userId === 'string' && o.userId.length > 0
    && typeof o.tenantId === 'string' && o.tenantId.length > 0
    && typeof o.role === 'string' && (NATIVE_ROLES as readonly string[]).includes(o.role)
    && typeof o.lastUsedAt === 'number' && Number.isFinite(o.lastUsedAt);
}

/** Opaque provider tokens are `userId:grantId:secret`; JWTs are dot-separated. */
export function looksLikeOpaqueOAuthToken(token: string): boolean {
  return !token.includes('.') && token.split(':').length === 3;
}

/**
 * Resolve a native client's access token to an identity, or null.
 *
 * Three conditions, all required: the provider knows the token and it has not
 * expired; both the grant and the token itself carry the native scope (an MCP
 * grant must not be usable against /api/*, because MCP scopes are narrower than
 * a session, and a token exchanged down to a narrower scope must not regain it);
 * and the user is still an active member. The returned role is the users row's
 * current role, never the one baked into the grant when it was consented, so a
 * demotion takes effect on the next request. Grant revocation on removal is the primary control;
 * the users-row check covers the window before it lands and a revocation that
 * failed open.
 */
export async function resolveNativeToken(env: NativeTokenEnv, token: string): Promise<NativeProps | null> {
  if (!env.OAUTH_PROVIDER) return null;
  const summary = await env.OAUTH_PROVIDER.unwrapToken(token);
  if (!summary) return null;
  if (!summary.grant.scope.includes(NATIVE_SCOPE) || !summary.scope.includes(NATIVE_SCOPE)) return null;
  const props = summary.grant.props;
  if (!isNativeProps(props)) return null;
  const row = await drizzle(env.DB)
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(and(eq(users.id, props.userId), eq(users.tenantId, props.tenantId), isNull(users.deletedAt)))
    .get();
  if (!row || !isNativeRole(row.role)) return null;
  return { ...props, role: row.role };
}
