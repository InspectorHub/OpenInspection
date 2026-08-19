/**
 * Which existing row an incoming entry collides with.
 *
 * Its own module because the answer is wanted at two different moments — when a
 * run is staged, and again immediately before it is applied — and a rule that
 * lived inside one of those callers would be re-derived by the other. Two
 * derivations of "is this the same person" drift, and the drift shows up as an
 * import that quietly created a duplicate or quietly overwrote a stranger.
 *
 * Matching is by email, never by a vendor identifier: an identifier from one
 * product is not an identity in another, and two vendors' identifiers can
 * collide. An entry with no email is never matched — merging two different
 * people who share a name cannot be undone, while a duplicate can be merged
 * later.
 */
import type { drizzle } from 'drizzle-orm/d1';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { contacts, tenantInvites, users } from '../db/schema';
import type { BundleContact, BundleMember, EntityKind } from './bundle';

/** The drizzle handle the intake path builds over its D1 binding. */
export type IntakeDb = ReturnType<typeof drizzle>;

/**
 * Remember the first row seen for an address, matched case-insensitively.
 *
 * First wins on purpose: when several rows answer to one address the earliest
 * is the one a later apply would have collided with, and picking a different
 * one each run would make the same file stage differently twice.
 */
function rememberByEmail(map: Map<string, string>, email: string | null, id: string): void {
    const key = (email ?? '').trim().toLowerCase();
    if (key && !map.has(key)) map.set(key, id);
}

/**
 * Mirrors the active-contact unique index: an ARCHIVED contact does not hold
 * the address, so importing that person again is a fresh row rather than a
 * clash. Comparison is case-insensitive, which is stricter than the index — a
 * differently-cased duplicate slips past the constraint and is still a
 * duplicate to the person reading the list.
 */
async function contactConflicts(
    db: IntakeDb,
    tenantId: string,
    entries: BundleContact[],
): Promise<(string | null)[]> {
    if (!entries.some((c) => c.email?.trim())) return entries.map(() => null);
    const existing = await db.select({ id: contacts.id, email: contacts.email })
        .from(contacts)
        .where(and(
            eq(contacts.tenantId, tenantId),
            isNotNull(contacts.email),
            isNull(contacts.archivedAt),
        ))
        .all();
    const byEmail = new Map<string, string>();
    for (const row of existing) rememberByEmail(byEmail, row.email, row.id);
    return entries.map((c) => {
        const key = c.email?.trim().toLowerCase();
        if (!key) return null;
        return byEmail.get(key) ?? null;
    });
}

/**
 * A member "already exists" if the address holds a live workspace row or an
 * invite row that has not been accepted.
 *
 * The invite half is decided by the partial unique index on
 * (tenant_id, email), whose predicate is the pending status ALONE: while such a
 * row is there a second invite to that address cannot be written, so calling it
 * "no clash" would hand apply a row whose only outcome is a constraint failure.
 * Expiry does not enter into it — an expired invite is a dead link, not a
 * released address. An ACCEPTED invite is outside the predicate and blocks
 * nothing; the member row it produced is what the first lookup finds, and a
 * REMOVED member frees the address again.
 */
async function memberConflicts(
    db: IntakeDb,
    tenantId: string,
    entries: BundleMember[],
): Promise<(string | null)[]> {
    const byEmail = new Map<string, string>();

    // Both lists are seat-bounded, so they are read whole and matched in
    // memory: neither column is stored case-folded, and an IN clause would
    // therefore answer only for addresses that happen to match in case.
    const activeUsers = await db.select({ id: users.id, email: users.email })
        .from(users)
        .where(and(eq(users.tenantId, tenantId), isNull(users.deletedAt)))
        .all();
    for (const row of activeUsers) rememberByEmail(byEmail, row.email, row.id);

    const outstanding = await db.select({ id: tenantInvites.id, email: tenantInvites.email })
        .from(tenantInvites)
        .where(and(eq(tenantInvites.tenantId, tenantId), eq(tenantInvites.status, 'pending')))
        .all();
    for (const row of outstanding) rememberByEmail(byEmail, row.email, row.id);

    return entries.map((m) => byEmail.get(m.email.trim().toLowerCase()) ?? null);
}

/**
 * Which existing row each entry collides with, in the order given.
 *
 * Takes a list of entries of ONE kind rather than a whole bundle, so the caller
 * that has rows rather than a bundle — the one re-checking just before it
 * writes — can ask the same question without reassembling a bundle to ask it
 * with.
 */
export async function resolveConflicts(
    db: IntakeDb,
    tenantId: string,
    kind: EntityKind,
    entries: unknown[],
    targetId: string | null,
): Promise<(string | null)[]> {
    switch (kind) {
        case 'template':
            // The only template a run can collide with is the one it was aimed
            // at. Nothing else in the file has a named counterpart, and a
            // same-name template is not the same template.
            return entries.map(() => targetId);
        case 'contact':
            return contactConflicts(db, tenantId, entries as BundleContact[]);
        case 'member':
            return memberConflicts(db, tenantId, entries as BundleMember[]);
    }
}
