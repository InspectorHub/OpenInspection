import { and, asc, eq, isNull } from 'drizzle-orm';
import { contacts } from '../../lib/db/schema/contact';
import { tenants } from '../../lib/db/schema/tenant';

/** One company a partner agent currently works with, and their identity there. */
export interface AgentCompany {
    tenantId: string;
    /** The `contacts` row this company holds for the agent — the preference subject. */
    contactId: string;
    name: string;
}

/**
 * The companies a partner agent is currently bound to.
 *
 * The predicate is the same one the referral reader uses for access
 * (`services/agent/referral.ts`): the binding lives on the contact
 * (`agent_user_id`, IA-104) and a revoked binding is stamped rather than
 * cleared, so `agent_revoked_at IS NULL` is what makes it current. Reusing the
 * predicate rather than restating it is deliberate — a screen that listed a
 * company the agent can no longer see would offer a control with nothing behind
 * it, and a revoked agent must not keep steering that company's sends.
 */
export async function listAgentCompanies(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: any,
    agentUserId: string,
): Promise<AgentCompany[]> {
    const rows = await db.select({
        tenantId: contacts.tenantId,
        contactId: contacts.id,
        name: tenants.name,
    }).from(contacts)
        .innerJoin(tenants, eq(tenants.id, contacts.tenantId))
        .where(and(
            eq(contacts.agentUserId, agentUserId),
            isNull(contacts.agentRevokedAt),
        ))
        .orderBy(asc(tenants.name))
        .all();

    return rows.map((r: { tenantId: string; contactId: string; name: string | null }) => ({
        tenantId: r.tenantId,
        contactId: r.contactId,
        name: r.name ?? r.tenantId,
    }));
}
