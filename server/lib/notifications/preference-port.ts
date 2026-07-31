import { drizzle } from 'drizzle-orm/d1';
import { and, eq, inArray, or } from 'drizzle-orm';
import { contacts, notificationPreferences, users } from '../db/schema';
import { isSuppressible } from './classes';

/**
 * The send-path preference port. `EmailService` asks it, per recipient, whether
 * this notification class may be withheld from this address.
 *
 * Deliberately the same shape as `EmailSuppressionPort` (WH-3), because it sits
 * at the same boundary and answers the same kind of question. The two are NOT
 * the same thing and must not be merged: suppression is a DELIVERABILITY fact
 * about an address (it bounced, it complained) that applies to everything;
 * a preference is a CHOICE about one kind of message.
 */
export interface NotificationPreferencePort {
    /** May `classId` be withheld from `email` on this channel? */
    isMuted(classId: string, email: string): Promise<boolean>;
}

/** A row in `notification_preferences` is keyed on one of these. */
export interface PreferenceSubject {
    kind: 'user' | 'contact';
    id: string;
}

/**
 * The decision itself, for callers that already KNOW who the subject is.
 *
 * The in-app path does: a notice header is `user_id XOR contact_id` by
 * construction, so it has the subject in hand and needs none of the
 * address-resolution the email path exists to do. Sharing this function rather
 * than the port is what keeps the two channels answering the same question —
 * the required check in particular must not exist twice.
 *
 * THE REQUIRED CHECK COMES FIRST, before any lookup: a class the recipient is
 * told is always sent stays unmutable even if a row says otherwise, and
 * `isSuppressible` fails closed on ids it has never heard of.
 */
export async function isPreferenceMuted(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    d: { select: (...args: any[]) => any },
    tenantId: string,
    classId: string,
    channel: 'email' | 'sms' | 'in_app',
    subjects: PreferenceSubject[],
): Promise<boolean> {
    if (!isSuppressible(classId)) return false;
    if (subjects.length === 0) return false;

    const byKind = (kind: 'user' | 'contact') =>
        subjects.filter((s) => s.kind === kind).map((s) => s.id);
    const userIds = byKind('user');
    const contactIds = byKind('contact');

    const match = [
        userIds.length
            ? and(eq(notificationPreferences.subjectKind, 'user'), inArray(notificationPreferences.subjectId, userIds))
            : undefined,
        contactIds.length
            ? and(eq(notificationPreferences.subjectKind, 'contact'), inArray(notificationPreferences.subjectId, contactIds))
            : undefined,
    ].filter(Boolean);

    const row = await d.select({ enabled: notificationPreferences.enabled })
        .from(notificationPreferences)
        .where(and(
            eq(notificationPreferences.tenantId, tenantId),
            eq(notificationPreferences.classId, classId),
            eq(notificationPreferences.channel, channel),
            match.length === 1 ? match[0] : or(...match),
            eq(notificationPreferences.enabled, false),
        ))
        .get();

    // Absence is not "off": no row means the class default applies.
    return !!row;
}

/**
 * Build the tenant-scoped preference port for the email channel.
 *
 * THE REQUIRED CHECK COMES FIRST, and it is the reason this is trustworthy. A
 * class the recipient is told is always sent must be unmutable even if a row
 * somehow says otherwise — a stale row, a class whose `required` flag changed,
 * a hand-written INSERT. `isSuppressible` fails closed on ids it has never
 * heard of, so an unclassified or newly-added notification is never withheld.
 * The screen's promise and the send path's behaviour therefore cannot diverge.
 *
 * An address is resolved to BOTH id spaces (`users` and `contacts`) because one
 * person can be both — an agent with an account who is also a contact on an
 * inspection. A mute in either space counts: they are the same human, and
 * asking them to switch something off twice would be the kind of half-working
 * control that is worse than none.
 *
 * FAIL-OPEN, like the suppression gate beside it: a lookup error means the mail
 * goes out. Silently dropping notifications because a query failed is the worse
 * of the two failures by a wide margin — the recipient never learns the message
 * existed.
 */
export function buildNotificationPreferences(db: D1Database, tenantId: string): NotificationPreferencePort {
    return {
        async isMuted(classId: string, email: string): Promise<boolean> {
            // Cheap exit before touching the DB at all.
            if (!isSuppressible(classId)) return false;

            const d = drizzle(db);
            const normalized = email.trim().toLowerCase();

            const [userRows, contactRows] = await Promise.all([
                d.select({ id: users.id }).from(users)
                    .where(and(eq(users.tenantId, tenantId), eq(users.email, normalized))).all(),
                d.select({ id: contacts.id }).from(contacts)
                    .where(and(eq(contacts.tenantId, tenantId), eq(contacts.email, normalized))).all(),
            ]);
            const subjects: PreferenceSubject[] = [
                ...userRows.map((r) => ({ kind: 'user' as const, id: r.id })),
                ...contactRows.map((r) => ({ kind: 'contact' as const, id: r.id })),
            ];
            return isPreferenceMuted(d, tenantId, classId, 'email', subjects);
        },
    };
}
