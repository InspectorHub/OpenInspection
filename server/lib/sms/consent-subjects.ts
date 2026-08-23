/**
 * WHO a phone number belongs to, for the SMS consent ledger.
 *
 * A person here is a `contacts` row OR a `users` row, and `sms_consent_log` and
 * `notification_preferences` are both keyed on a (subject_kind, subject_id)
 * PAIR because of it. Staff are the second kind and have no contact at all, so
 * anything that resolves a recipient out of `contacts` alone is silently blind
 * to them: no error, no log, no refusal.
 *
 * ONE matcher, used by both ends of the round trip — the inbound STOP webhook
 * that RECORDS a revocation and the send gate that READS it. They used to hold
 * a copy each, and a copy only finds what someone remembered to teach it: the
 * webhook wrote a staff revocation nowhere, and even once the row existed the
 * gate's own copy could not find it. Two matchers that disagree about who a
 * number is produce a revocation recorded against someone the send path never
 * consults, which is indistinguishable from no revocation at all.
 *
 * Matching is on the NORMALIZED phone, because stored phones are field-entered
 * and may not be.
 */
import { and, eq, isNotNull } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { contacts, tenantConfigs, users } from '../db/schema';
import { normalizeE164 } from './phone';
import type { ConsentRecipientType } from './consent-basis';

/** A person, in whichever id space they live in. */
interface ConsentSubject {
    kind: 'contact' | 'user';
    id: string;
}

/** A subject found by number, with the tenant and basis a consent row needs. */
export interface PhoneMatchedSubject extends ConsentSubject {
    tenantId: string;
    /**
     * The basis this person is reachable under, which is what a carrier audit
     * reads — never the subject kind wearing a different name.
     *
     * For a contact it is `contacts.type`, and the mapping is the IDENTITY: that
     * column is the same client / agent / other axis `CONSENT_BASIS_BY_KIND` is
     * keyed on, so the compiler proves this is total rather than a table someone
     * has to maintain. Defaulting every inbound row to `client` instead made the
     * ledger wrong in the one direction it is read in — a count of consumer
     * opt-out evidence would include every business counterparty who ever
     * texted STOP.
     *
     * A `users` row inside a tenant is a seat, so it is `staff`: internal
     * operational messaging under account terms, never consumer consent.
     */
    recipientType: ConsentRecipientType;
}

// Callers pass tenant-scoped drizzle handles with different schema maps; this
// only touches two tables by name.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDrizzle = DrizzleD1Database<any>;

/**
 * Everyone whose stored number is `phone`, in both id spaces.
 *
 * `scopeTenantId` null is the PLATFORM shared-number shape: every tenant except
 * those sending from their own number, which the shared number does not reach
 * and whose recipients therefore never texted it.
 *
 * A global agent account carries `tenant_id IS NULL` (it reaches a company
 * through that company's `contacts` row, which is where its consent belongs)
 * and a consent event has to name a tenant, so a user with no tenant is not a
 * subject here.
 */
export async function subjectsForPhone(
    db: AnyDrizzle,
    scopeTenantId: string | null,
    phone: string | null | undefined,
): Promise<PhoneMatchedSubject[]> {
    const target = normalizeE164(phone);
    if (!target) return [];

    const [contactRows, userRows] = await Promise.all([
        db.select({ id: contacts.id, tenantId: contacts.tenantId, phone: contacts.phone, type: contacts.type })
            .from(contacts)
            .where(scopeTenantId ? eq(contacts.tenantId, scopeTenantId) : undefined)
            .all(),
        db.select({ id: users.id, tenantId: users.tenantId, phone: users.phone })
            .from(users)
            .where(scopeTenantId ? eq(users.tenantId, scopeTenantId) : isNotNull(users.tenantId))
            .all(),
    ]);

    const matched: PhoneMatchedSubject[] = [
        ...contactRows
            .filter((r) => normalizeE164(r.phone) === target)
            .map((r): PhoneMatchedSubject => ({
                kind: 'contact', id: r.id, tenantId: r.tenantId, recipientType: r.type,
            })),
        ...userRows
            .filter((r) => normalizeE164(r.phone) === target)
            .flatMap((r): PhoneMatchedSubject[] => (r.tenantId
                ? [{ kind: 'user', id: r.id, tenantId: r.tenantId, recipientType: 'staff' }]
                : [])),
    ];
    if (scopeTenantId) return matched;

    const cfgs = await db.select({ tenantId: tenantConfigs.tenantId, smsMode: tenantConfigs.smsMode })
        .from(tenantConfigs).all();
    const ownNumber = new Set(cfgs.filter((r) => r.smsMode === 'own').map((r) => r.tenantId));
    return matched.filter((r) => !ownNumber.has(r.tenantId));
}

/**
 * Which id space a subject id names — ASKED, not assumed.
 *
 * A caller holding one id cannot tell from the string which table it came from,
 * and the send path is handed a `users` id for a staff or inspector recipient
 * (`server/services/automation/recipients.ts` says so where it builds the row).
 * Labelling every id `contact` on the way into a preference lookup meant the
 * screen wrote one kind and the send path read the other, so no staff row could
 * ever match.
 *
 * An id in neither table reads as `contact`, which is what every id read as
 * before: an unknown subject finds no row and falls back to the class default,
 * exactly as it did.
 */
export async function subjectKindOf(
    db: AnyDrizzle,
    tenantId: string,
    id: string,
): Promise<'contact' | 'user'> {
    const row = await db.select({ id: users.id }).from(users)
        .where(and(eq(users.tenantId, tenantId), eq(users.id, id))).get();
    return row ? 'user' : 'contact';
}
