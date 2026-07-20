import { drizzle } from 'drizzle-orm/d1';
import { and, eq, isNull } from 'drizzle-orm';
import { users } from '../../lib/db/schema/tenant';

export interface GlobalAgentAccount {
    id: string;
    email: string;
    // Spec 3 Task 5 — the password-login route (server/api/agent/login.ts)
    // needs the hash to verify against; every other existing caller ignores
    // this extra field, so widening the shared row shape here is additive
    // and keeps the ONE predicate query as the single source (no second
    // "same predicate but with passwordHash" query duplicated elsewhere).
    passwordHash: string;
}

const SELECT_FIELDS = { id: users.id, email: users.email, passwordHash: users.passwordHash };

/**
 * Single source of the "live global agent account" predicate — tenant_id IS
 * NULL (agents are global users), role='agent', not soft-deleted. Consumed by
 * AgentService.accountExistsForEmail (Spec 3 Task 2), the magic-login
 * primitive (server/services/agent/magic-login.service.ts), and the agent
 * password login (server/api/agent/login.ts — Spec 3 Task 5). Keeping ONE
 * query here means a future change to what counts as a "live" agent account
 * (e.g. an added suspension flag) only needs one edit.
 */
export async function findGlobalAgentByEmail(
    rawDb: D1Database,
    email: string,
): Promise<GlobalAgentAccount | null> {
    const row = await drizzle(rawDb)
        .select(SELECT_FIELDS)
        .from(users)
        .where(and(
            eq(users.email, email),
            eq(users.role, 'agent'),
            isNull(users.tenantId),
            isNull(users.deletedAt),
        ))
        .get();
    return row ?? null;
}

/**
 * Same predicate, keyed by userId. Used to re-verify a magic-login code's
 * cached agent identity AT REDEEM TIME (not just at issue time) — the account
 * may have been deleted or demoted from 'agent' during the code's TTL window.
 * Mirrors the GET /sso consume handler's own re-check
 * (`isNull(users.deletedAt)` — server/api/auth.ts) that a portal handoff must
 * not mint a session for a since-removed account.
 */
export async function findGlobalAgentById(
    rawDb: D1Database,
    userId: string,
): Promise<GlobalAgentAccount | null> {
    const row = await drizzle(rawDb)
        .select(SELECT_FIELDS)
        .from(users)
        .where(and(
            eq(users.id, userId),
            eq(users.role, 'agent'),
            isNull(users.tenantId),
            isNull(users.deletedAt),
        ))
        .get();
    return row ?? null;
}
