import { drizzle } from 'drizzle-orm/d1';
import { and, eq, isNull } from 'drizzle-orm';
import { users } from '../../lib/db/schema/tenant';
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
        /**
         * REQUIRED, and it carries a version and a content hash rather than URLs.
         *
         * A URL records where the text WAS, not what it SAID: the page behind it
         * can be edited, and the acceptance then points at something the signer
         * never read. Version plus hash is the only pair that survives the text
         * changing, and it is the standard every other legal artefact here
         * already meets.
         */
        termsAccepted?: {
            at: string; version: string; contentHash: string;
            ip?: string; country?: string;
        } | undefined;
    },
): Promise<{ userId: string; email: string }> {
    const db = drizzle(rawDb);
    const email = normalizeEmail(input.email);

    // FAIL CLOSED, and BEFORE the insert. An agent is a third party who has
    // agreed to a document written for them, and an account that
    // exists without a recorded acceptance is the state this removes.
    //
    // Refusing before the insert rather than after is not tidiness: a caller who
    // fixes their payload and retries must not collide with a 409 from their own
    // rejected first attempt.
    if (!input.termsAccepted) {
        throw Errors.BadRequest('Agent terms must be accepted before an account is created');
    }
    if (!input.termsAccepted.version || !/^[0-9a-f]{64}$/.test(input.termsAccepted.contentHash ?? '')) {
        // An acceptance without a hash points at nothing checkable. Storing one
        // would be worse than storing none, because it reads as evidence.
        throw Errors.BadRequest(
            'Agent terms acceptance must carry the version and the content hash of the text shown',
        );
    }

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
        termsAccepted: input.termsAccepted,
    });

    await autoLinkSameEmail(rawDb, id, email);
    return { userId: id, email };
}

/**
 * Same-email auto-link: when an agent account is created at signup, find every
 * ACTIVE `contacts` row in any tenant where `type='agent'` and `email` matches
 * the agent's email, and bind the account to it (IA-104: a column on the
 * contact, not a row in a join table).
 *
 * Idempotent twice over — the `agent_user_id IS NULL` guard means an already
 * bound contact is not re-stamped, and uq_contacts_tenant_agent_user stops a
 * second contact in the same tenant claiming the same account.
 *
 * Returns the count of contacts newly bound (second call returns 0).
 */
export async function autoLinkSameEmail(
    rawDb: D1Database,
    userId: string,
    email: string,
): Promise<number> {
    const db = drizzle(rawDb);
    const normalized = normalizeEmail(email);
    // Archived contacts must not be bound: binding a retired record would
    // consume this tenant's one slot for the account (see the partial unique
    // index) while every inspection names the live row.
    //
    // `agent_user_id IS NULL` is part of the QUERY, not just the update's
    // where-clause, so the count below is derived from rows we selected rather
    // than from a driver's changes counter — D1 reports that as
    // `res.meta.changes` and better-sqlite3 as `res.changes`, so reading
    // either one is silently zero under the other.
    const matches = await db
        .select({ id: contacts.id, tenantId: contacts.tenantId })
        .from(contacts)
        .where(and(
            eq(contacts.email, normalized),
            eq(contacts.type, 'agent'),
            isNull(contacts.archivedAt),
            isNull(contacts.agentUserId),
        ))
        .all();

    let created = 0;
    for (const row of matches) {
        try {
            // IA-104 — binding is now an UPDATE on the contact rather than an
            // insert into a join table. The contact already carries the tenant
            // and is the row every inspection names, so there is nothing left
            // for a link row to add: it existed only to point at this record.
            //
            // `invitedByUserId` is gone with it. It duplicated
            // `contacts.createdByUserId`, which is the same fact (who brought
            // this person into the workspace) already on the row — and the old
            // owner-fallback existed only because the link could be created
            // for a contact that did not exist yet. That case is impossible
            // now: we are here BECAUSE the contact exists.
            // Scoped by tenantId as well as id. This function is deliberately
            // cross-tenant (it binds the account in EVERY workspace holding
            // this email), so there is no single ambient tenant to filter on —
            // but each write still names the one tenant it belongs to, taken
            // from the row just read. An id-only update here would be the
            // shape that leaks across tenants when a caller is less careful.
            await db
                .update(contacts)
                .set({ agentUserId: userId, agentLinkedAt: new Date() })
                .where(and(
                    eq(contacts.id, row.id),
                    eq(contacts.tenantId, row.tenantId),
                    isNull(contacts.agentUserId),
                ));
            created++;
        } catch {
            // uq_contacts_tenant_agent_user violation — this tenant already
            // has a live contact bound to this account. Skip, as before.
        }
    }
    logger.info('agent.autolink', { userId, email: normalized, count: created });
    return created;
}
