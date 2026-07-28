import { drizzle } from 'drizzle-orm/d1';
import { and, eq, isNull } from 'drizzle-orm';
import { agentTenantLinks, users } from '../../lib/db/schema/tenant';
import { contacts } from '../../lib/db/schema/contact';
import { Errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { hashPassword } from '../../lib/password';
import { normalizeEmail } from './shared';

/**
 * Self-serve signup: create a global agent user, run autoLinkSameEmail to
 * surface every tenant that already had this email as a contact, return
 * the user id. Conflict (existing email) -> 409 with loginUrl hint.
 */
export async function signup(
    rawDb: D1Database,
    input: {
        email: string;
        password: string;
        name: string;
        termsAccepted?: { at: string; ip?: string; country?: string; termsUrl?: string; privacyUrl?: string };
    },
): Promise<{ userId: string; email: string }> {
    const db = drizzle(rawDb);
    const email = normalizeEmail(input.email);

    const existing = await db
        .select({ id: users.id, role: users.role })
        .from(users)
        .where(eq(users.email, email))
        .get();
    if (existing) {
        throw Errors.Conflict('An account with this email already exists');
    }

    const id = crypto.randomUUID();
    const passwordHash = await hashPassword(input.password);
    await db.insert(users).values({
        id,
        tenantId: null,
        email,
        passwordHash,
        name: input.name,
        role: 'agent',
        createdAt: new Date(),
        termsAccepted: input.termsAccepted ?? null,
    });

    await autoLinkSameEmail(rawDb, id, email);
    return { userId: id, email };
}

/**
 * Same-email auto-link: when an agent account is created at signup, find every
 * ACTIVE `contacts` row in any tenant where `type='agent'` and `email` matches
 * the agent's email, and create an `active` agent_tenant_links row for each.
 * Skips existing links thanks to the unique (agent_user_id, tenant_id) index.
 *
 * This is now the ONLY producer of agent_tenant_links rows (the invite-accept
 * path is gone), and it always sets `inspectorContactId` — which is what lets
 * that column be NOT NULL.
 *
 * Returns the count of new links created (idempotent — second call returns 0).
 */
export async function autoLinkSameEmail(
    rawDb: D1Database,
    userId: string,
    email: string,
): Promise<number> {
    const db = drizzle(rawDb);
    const normalized = normalizeEmail(email);
    // ARCHIVED CONTACTS MUST NOT WIN THE LINK. `contacts` allows one ACTIVE
    // row per (tenant, email) but any number of archived ones, and
    // agent_tenant_links allows only one row per (agent, tenant) — so without
    // this filter a tenant that had archived an old contact and made a fresh
    // one could get a link pointing at the dead record, while every inspection
    // referenced the live one. The insert below would then silently skip the
    // correct contact on the unique-index catch, and the agent's referral list
    // would be empty for reasons nothing surfaced.
    const matches = await db
        .select({
            id: contacts.id,
            tenantId: contacts.tenantId,
            createdByUserId: contacts.createdByUserId,
        })
        .from(contacts)
        .where(and(
            eq(contacts.email, normalized),
            eq(contacts.type, 'agent'),
            isNull(contacts.archivedAt),
        ))
        .all();

    let created = 0;
    for (const row of matches) {
        try {
            // Use contact.createdByUserId as the inviting inspector when present
            // so /agent-inspectors can render the inspector's name + slug. When
            // the contact predates this column or was imported in bulk, fall
            // back to the tenant owner so the auto-linked card still shows a
            // real person instead of a generic tenant-only stub.
            let invitedByUserId: string | null = row.createdByUserId ?? null;
            if (!invitedByUserId) {
                const owner = await db
                    .select({ id: users.id })
                    .from(users)
                    .where(and(eq(users.tenantId, row.tenantId), eq(users.role, 'owner')))
                    .get();
                invitedByUserId = owner?.id ?? null;
            }
            await db.insert(agentTenantLinks).values({
                id: crypto.randomUUID(),
                agentUserId: userId,
                tenantId: row.tenantId,
                inspectorContactId: row.id,
                status: 'active',
                invitedByUserId,
                createdAt: new Date(),
            });
            created++;
        } catch {
            // unique-index violation (already linked) — skip silently.
        }
    }
    logger.info('agent.autolink', { userId, email: normalized, count: created });
    return created;
}
