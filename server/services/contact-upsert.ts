import { eq, and, isNull, desc } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { contacts } from '../lib/db/schema/contact';
import { Errors } from '../lib/errors';
import { visibleContactsCondition, type InspectionScope } from '../lib/inspection/visibility';

type Db = DrizzleD1Database<Record<string, unknown>>;

export interface UpsertContactInput {
    name: string;
    email?: string | undefined;
    phone?: string | undefined;
    type: 'client' | 'agent';
    locale?: string | null | undefined;
}

/**
 * Refuses, with the answer contact create gives for an address already in use, when `contactId` is not one the
 * scope can see. Nothing about the contact is returned.
 */
async function refuseHiddenMatch(db: Db, tenantId: string, contactId: string, scope: InspectionScope): Promise<void> {
    if (scope.kind === 'all') return;
    const visible = await db.select({ id: contacts.id }).from(contacts)
        .where(and(eq(contacts.id, contactId), eq(contacts.tenantId, tenantId), visibleContactsCondition(db, scope, tenantId))).get();
    if (!visible) throw Errors.Conflict('A contact with this email already exists');
}

/**
 * Checks before anything is written that none of these addresses belongs to a contact the scope cannot see, so a
 * create that names several people is refused whole rather than half done.
 */
export async function assertEmailsNotHidden(
    db: Db, tenantId: string, emails: ReadonlyArray<string | null | undefined>, scope: InspectionScope,
): Promise<void> {
    if (scope.kind === 'all') return;
    for (const raw of emails) {
        const email = raw ? raw.toLowerCase().trim() : '';
        if (!email) continue;
        const existing = await db.select({ id: contacts.id }).from(contacts)
            .where(and(eq(contacts.tenantId, tenantId), eq(contacts.email, email), isNull(contacts.archivedAt))).get();
        if (existing) await refuseHiddenMatch(db, tenantId, existing.id, scope);
    }
}

/**
 * IA-1 — Idempotent upsert used during inspection creation to capture client
 * and agent people without double-creating rows.
 *
 * Rules:
 * - Email is normalized to lowercase+trim before any lookup or write.
 * - Email present: find ACTIVE (archived_at IS NULL) row by (tenantId, normalizedEmail).
 *   - Found: fill-forward: set name/phone ONLY where existing value is null/empty. Returns {id, created:false}.
 *     A match outside `scope` is refused (see refuseHiddenMatch) before anything is touched.
 *   - Not found: INSERT a new row. Returns {id, created:true}.
 * - Email absent, unrestricted scope: always INSERT a name-only row. Returns {id, created:true}.
 * - Email absent, scope limited to assignments: the name is looked up among ACTIVE contacts of the same type the
 *   scope can see, and nowhere else. None: INSERT. One: reuse it. Several: reuse the most recently created.
 *   A contact outside the scope is never matched, touched or hinted at, so a name only a hidden contact carries
 *   simply creates a new row. Nothing is filled forward on a name match; the caller gave no address to trust.
 * - Archived rows with matching email are NOT matched (the partial unique allows a fresh active row).
 */
export async function upsertContactByEmail(
    db: Db, tenantId: string, input: UpsertContactInput, scope: InspectionScope,
): Promise<{ id: string; created: boolean }> {
    const normalizedEmail = input.email ? input.email.toLowerCase().trim() : undefined;

    if (normalizedEmail) {
        // Look for an ACTIVE row with this email (archived_at IS NULL).
        const existing = await db
            .select()
            .from(contacts)
            .where(and(eq(contacts.tenantId, tenantId), eq(contacts.email, normalizedEmail), isNull(contacts.archivedAt)))
            .get();

        if (existing) {
            await refuseHiddenMatch(db, tenantId, existing.id, scope);
            // Fill-forward: only update name/phone if currently null/empty.
            const updates: Partial<{ name: string; phone: string; locale: string }> = {};
            if ((!existing.name || existing.name.trim() === '') && input.name) {
                updates.name = input.name;
            }
            if ((!existing.phone || existing.phone.trim() === '') && input.phone) {
                updates.phone = input.phone;
            }
            // Locale does NOT fill forward: the contact has just told us
            // again, and the newer answer is the true one. Being written to
            // in English after asking for Spanish is the failure this
            // avoids. An omitted choice still never clears a stored one —
            // silence is not a retraction.
            if (input.locale && input.locale !== existing.locale) {
                updates.locale = input.locale;
            }
            if (Object.keys(updates).length > 0) {
                await db
                    .update(contacts)
                    .set(updates)
                    // tenantId as well as id: `existing` came from a
                    // tenant-scoped read, so this is belt-and-braces, but
                    // an id-only write is the shape the scoping gate exists
                    // to keep out of the codebase — and it costs nothing.
                    .where(and(eq(contacts.id, existing.id), eq(contacts.tenantId, tenantId)));
            }
            return { id: existing.id, created: false };
        }
    }

    if (!normalizedEmail && scope.kind !== 'all') {
        const name = input.name.trim();
        const reuse = name ? await db.select({ id: contacts.id }).from(contacts).where(and(
            eq(contacts.tenantId, tenantId), eq(contacts.type, input.type), eq(contacts.name, name), isNull(contacts.archivedAt),
            visibleContactsCondition(db, scope, tenantId),
        )).orderBy(desc(contacts.createdAt), desc(contacts.id)).get() : undefined;
        if (reuse) return { id: reuse.id, created: false };
    }

    // INSERT — either no email or no matching active row found.
    const id = crypto.randomUUID();
    await db.insert(contacts).values({
        id,
        tenantId,
        type: input.type,
        name: input.name,
        email: normalizedEmail ?? null,
        phone: input.phone ?? null,
        agency: null,
        notes: null,
        locale: input.locale ?? null,
        // A creator limited to their assignments keeps seeing the contact they made, so a second create that names
        // it finds it even before it is attached to a visible inspection.
        ...(scope.kind === 'all' ? {} : { createdByUserId: scope.userId }),
        createdAt: new Date(),
    });
    return { id, created: true };
}
