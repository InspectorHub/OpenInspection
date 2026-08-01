/**
 * Communication C1 (design §3.13) — notice HEADER writer.
 *
 * A header is one `notifications` row per recipient x notice: it carries WHO
 * the notice is for (user_id XOR contact_id), what it concerns
 * (inspection_id / entity), and the recipient's read state. The per-channel
 * delivery attempts live in `automation_logs` rows stamped with `notice_id`
 * — they BELONG to the header, so the two cannot disagree; the only
 * degenerate state is a header with zero details (nothing dispatched yet),
 * which is legible rather than contradictory.
 *
 * The XOR invariant lives HERE because the DB cannot express it: SQLite has
 * no usable CHECK path on an existing D1 table, so the service layer is the
 * only gate. Every header write goes through this function.
 */
import { inArray } from 'drizzle-orm';
import { automationLogs } from '../../lib/db/schema';
import { insertNotificationRow } from '../notification.service';
import { nanoid } from 'nanoid';
import { isStaffRecipient } from './shared';
import { isPreferenceMuted, type PreferenceSubject } from '../../lib/notifications/preference-port';

export interface NoticeHeaderInput {
    tenantId: string;
    /** Staff recipient (users.id). Exactly one of userId/contactId must be set. */
    userId?: string | null;
    /** External recipient (contacts.id). Exactly one of userId/contactId must be set. */
    contactId?: string | null;
    type: string;
    title: string;
    body?: string | null;
    inspectionId?: string | null;
    entityType?: string | null;
    entityId?: string | null;
    metadata?: Record<string, unknown> | null;
    /**
     * A `NOTIFICATION_CLASSES` id. When given, the recipient's in-app
     * preference is consulted before the header is written — the notice IS the
     * in-app delivery, so withholding it means not writing the row.
     *
     * Absent ⇒ unclassified ⇒ always written, matching the email boundary's
     * posture: a send that cannot say what it is must never be silenced by
     * guesswork.
     */
    classId?: string | undefined;
}

// Accept the D1 drizzle instance or the better-sqlite3 test db — same builder surface.
type AnyDb = { insert: (...args: never[]) => unknown };

export async function insertNoticeHeader(rawDb: AnyDb, input: NoticeHeaderInput): Promise<string | null> {
    const userId = input.userId ?? null;
    const contactId = input.contactId ?? null;
    if ((userId === null) === (contactId === null)) {
        throw new Error(
            `notice header requires exactly one recipient: userId=${String(userId)} contactId=${String(contactId)}`,
        );
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = rawDb as any;

    // The recipient's own kill switch, sharing the decision with the email
    // boundary rather than restating it — the required check in particular
    // must not exist in two places, or the screen's promise and the send
    // path's behaviour can drift apart. FAIL-OPEN on a lookup error: a failed
    // query must never be the reason a notice was not written.
    if (input.classId) {
        const subject: PreferenceSubject = userId
            ? { kind: 'user', id: userId }
            : { kind: 'contact', id: contactId! };
        let muted = false;
        try {
            muted = await isPreferenceMuted(db, input.tenantId, input.classId, 'in_app', [subject]);
        } catch { muted = false; }
        if (muted) return null;
    }
    const id = nanoid();
    // The row write itself belongs to NotificationService — one owner for this
    // table (lint:provider-helpers). What stays here is what a header MEANS:
    // the XOR above, the id, and the defaults below.
    await insertNotificationRow(db, {
        id,
        tenantId: input.tenantId,
        userId,
        contactId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        inspectionId: input.inspectionId ?? null,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        metadata: input.metadata ?? null,
        readAt: null,
        archivedAt: null,
        createdAt: new Date(),
    });
    return id;
}

/**
 * Group freshly-inserted `automation_logs` rows by (rule firing x recipient),
 * write one notice header per group, and stamp `notice_id` onto that
 * recipient's channel rows. Staff recipients are USERS: resolveRecipients
 * stuffs the user id into `contactId` for the inspector and staff kinds, and
 * `isStaffRecipient` (shared.ts) decides which side of the header's XOR that
 * lands on — one rule, so the two kinds cannot drift apart. A row whose
 * recipient resolves to neither keeps notice_id NULL and the Outbox grouping
 * falls back to the interim (automation_id, send_at) key.
 *
 * Called with rows the insert ACTUALLY returned — a report.published retry
 * conflicts away via onConflictDoNothing and must not orphan fresh headers.
 */
export interface NoticeWording {
    title: string;
    body: string | null;
}

export async function createHeadersForInsertedLogs(
    rawDb: AnyDb,
    ctx: { tenantId: string; inspectionId: string; triggerEvent: string },
    /**
     * The wording for one rule's notice (B3/IA-115). Per-RULE, not per-batch:
     * two rules on the same event can carry different in-app templates, and a
     * single title for the whole firing would silently pick one of them.
     */
    wordingFor: (automationId: string | null) => NoticeWording,
    /**
     * The notification class for one rule's notice — per-RULE for the same
     * reason `wordingFor` is: two rules on one event are two different things
     * to have a preference about.
     */
    classFor: (automationId: string | null) => string | undefined,
    inserted: Array<{ id: string; automationId: string | null; sendAt: Date | number;
        recipientContactId: string | null; recipientRoleKey: string | null }>,
): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = rawDb as any;
    const groups = new Map<string, { ids: string[]; userId: string | null; contactId: string | null; automationId: string | null }>();
    for (const row of inserted) {
        const isStaff = isStaffRecipient(row.recipientRoleKey);
        const userId = isStaff && row.recipientContactId ? row.recipientContactId : null;
        const contactId = !isStaff && row.recipientContactId ? row.recipientContactId : null;
        if (!userId && !contactId) continue;
        const sendAtMs = row.sendAt instanceof Date ? row.sendAt.getTime() : Number(row.sendAt);
        const key = `${row.automationId}:${sendAtMs}:${userId ?? ''}:${contactId ?? ''}`;
        const g = groups.get(key) ?? { ids: [], userId, contactId, automationId: row.automationId };
        g.ids.push(row.id);
        groups.set(key, g);
    }
    for (const g of groups.values()) {
        const wording = wordingFor(g.automationId);
        const classId = classFor(g.automationId);
        const noticeId = await insertNoticeHeader(db, {
            tenantId: ctx.tenantId,
            userId: g.userId,
            contactId: g.contactId,
            type: ctx.triggerEvent,
            title: wording.title,
            body: wording.body,
            inspectionId: ctx.inspectionId,
            entityType: 'inspection',
            entityId: ctx.inspectionId,
            metadata: g.automationId ? { automationId: g.automationId } : null,
            ...(classId ? { classId } : {}),
        });
        if (noticeId === null) {
            // The recipient switched this off. The notice IS the in-app
            // delivery, so there is nothing to link — record WHY rather than
            // leaving a pending row that never resolves.
            await db.update(automationLogs).set({ status: 'skipped', error: 'muted by recipient' })
                .where(inArray(automationLogs.id, g.ids));
            continue;
        }
        await db.update(automationLogs).set({ noticeId })
            .where(inArray(automationLogs.id, g.ids));
    }
}
