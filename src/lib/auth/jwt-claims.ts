import type { JWTPayload } from 'hono/utils/jwt/types';
import type { UserRole } from '../../types/auth';

/**
 * Agent Accounts A1 — pure helper that classifies a verified JWT payload into
 * the per-request context shape. Extracted from the inline middleware in
 * src/index.ts so the role=agent branch can be exercised in isolation.
 *
 * Returns:
 *   - `{ kind: 'agent', userId }` for global agent accounts. No tenantId — the
 *     handler resolves a tenant per-request via resolveAgentTenant().
 *   - `{ kind: 'tenant', userId, role, tenantId }` for inspector / owner / admin
 *     accounts that are scoped to a single tenant via the JWT claim.
 *   - `{ kind: 'unscoped', userId, role }` when the role is non-agent but the
 *     tenantId claim is missing — caller decides whether to allow or reject.
 */
export type JwtClassification =
    | { kind: 'agent'; userId: string }
    | { kind: 'tenant'; userId: string; role: UserRole; tenantId: string }
    | { kind: 'unscoped'; userId: string; role: UserRole };

export function classifyJwtPayload(payload: JWTPayload): JwtClassification | null {
    const userId = payload.sub as string | undefined;
    if (!userId) return null;

    const userRole = (payload['custom:userRole'] ?? payload['role']) as string | undefined;
    const tenantId = (payload['custom:tenantId'] ?? payload['tenantId']) as string | undefined;

    if (userRole === 'agent') {
        return { kind: 'agent', userId };
    }

    if (!userRole) return null;

    if (tenantId) {
        return { kind: 'tenant', userId, role: userRole as UserRole, tenantId };
    }

    return { kind: 'unscoped', userId, role: userRole as UserRole };
}
