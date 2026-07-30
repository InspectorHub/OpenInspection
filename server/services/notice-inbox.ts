/**
 * Track C3 — the outward Notices inbox (design §3.11, §3.13, §3.15).
 *
 * One reader, two audiences: a client reads the notices addressed to them in
 * one company, an agent reads theirs across every company they work with. Both
 * are the SAME query — `notifications WHERE contact_id IN (me)` — because C1
 * made the header per-recipient. The difference is only which contact rows
 * resolve to "me", which is what the two resolver functions below answer.
 *
 * Two rules hold this file together:
 *
 * 1. **Address by contact id, never by the recipient STRING.** Matching
 *    `automation_logs.recipient` against the session email looks equivalent
 *    and silently drops every SMS row, whose recipient is a phone number. The
 *    header carries the contact; the logs hang off the header.
 * 2. **Dismissing a Notice never touches `automation_logs`** (§3.15). A
 *    recipient tidying their own inbox cannot edit the sender's audit trail —
 *    the Outbox still shows the delivery, with its status, forever. That is
 *    why `archiveNotice` writes to `notifications` and nothing else.
 *
 * Scope is by construction rather than by filtering: because the header is
 * per-recipient, no other party's address is reachable from these reads at
 * all. The cross-recipient test is the one that matters
 * (`tests/unit/notifications/notice-inbox.spec.ts`).
 */
import { and, desc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import { notifications, automationLogs, contacts, tenants } from '../lib/db/schema';

/** Accepts the D1 drizzle instance or the better-sqlite3 test db. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

interface NoticeChannelAttempt {
    channel: string;
    status: 'pending' | 'sent' | 'failed' | 'skipped';
    /** The RAW stored reason. The audience-specific wording lives in the UI —
     *  the operator map and the client map are deliberately different (§3.16). */
    reasonCode: string | null;
    /** The recipient's OWN address for this channel. Safe to show: the header
     *  is per-recipient, so this is never someone else's. */
    recipient: string;
    deliveredAt: number | null;
    sendAt: number;
}

export interface NoticeRow {
    id: string;
    tenantId: string;
    type: string;
    title: string;
    body: string | null;
    inspectionId: string | null;
    createdAt: number;
    readAt: number | null;
    /** The recipient contact this notice is addressed to (never another party). */
    contactId: string;
    /** Sending company's display name. Always resolved, rendered only by the
     *  agent inbox — theirs is the one that spans companies, so "who sent
     *  this" is information a single-company client inbox does not need. */
    companyName: string | null;
    channels: NoticeChannelAttempt[];
}

const toMs = (v: Date | number | null | undefined): number | null =>
    v == null ? null : v instanceof Date ? v.getTime() : Number(v);

/**
 * Only notices that have actually been dispatched (design §3.14).
 *
 * `trigger()` writes every log the instant a rule fires — delay and all — so
 * `send_at` is the ONLY thing between a delayed automation and the recipient's
 * bell. A "three days after the report" notice appearing the moment the report
 * is published is not an early notification, it is a wrong one. A header with
 * no attempt at all is likewise invisible here: "nothing dispatched yet" is a
 * legible state for the SENDER (§3.13), but there is nothing to tell a
 * recipient about.
 */
function dispatchedNoticeIds(db: AnyDb) {
    return db.select({ id: automationLogs.noticeId })
        .from(automationLogs)
        .where(lte(automationLogs.sendAt, new Date()));
}

/* ------------------------------------------------------------------ */
/*  Who am I — the two resolvers                                       */
/* ------------------------------------------------------------------ */

/**
 * The client side. A portal session carries a verified email and the tenant
 * comes from the path, so "me" is every live contact row with that email in
 * that one tenant. Tenant-scoped on purpose: the same address in another
 * company is a different person's record there.
 */
export async function contactIdsForEmail(db: AnyDb, tenantId: string, email: string): Promise<string[]> {
    const normalized = email.trim().toLowerCase();
    if (!normalized) return [];
    // Case-folded in SQL: stored addresses are not guaranteed normalized, and
    // pulling a tenant's whole contact book back to filter in JS would make the
    // bell's cost scale with the company rather than with the person.
    const rows = await db.select({ id: contacts.id })
        .from(contacts)
        .where(and(
            eq(contacts.tenantId, tenantId),
            isNull(contacts.archivedAt),
            sql`lower(trim(${contacts.email})) = ${normalized}`,
        ));
    return rows.map((r: { id: string }) => r.id);
}

/**
 * The agent side. An agent account is global (`users.tenant_id IS NULL`), and
 * IA-104 put the binding ON the contact row, so "every tenant that is me" is
 * one indexed read (`idx_contacts_agent_user`). No email fallback: the binding
 * is a column on the row it names and cannot go stale relative to it.
 */
export async function contactIdsForAgent(db: AnyDb, agentUserId: string): Promise<string[]> {
    if (!agentUserId) return [];
    const rows = await db.select({ id: contacts.id })
        .from(contacts)
        .where(and(
            eq(contacts.agentUserId, agentUserId),
            isNull(contacts.archivedAt),
            isNull(contacts.agentRevokedAt),
        ));
    return rows.map((r: { id: string }) => r.id);
}

/* ------------------------------------------------------------------ */
/*  The inbox reads                                                    */
/* ------------------------------------------------------------------ */

export async function listNoticesForContacts(
    db: AnyDb,
    params: { contactIds: string[]; limit?: number; includeArchived?: boolean },
): Promise<NoticeRow[]> {
    const { contactIds } = params;
    // An empty set must read NOTHING. `inArray(col, [])` is a foot-gun in every
    // ORM; short-circuit rather than let it reach the query.
    if (contactIds.length === 0) return [];
    const limit = Math.min(params.limit ?? 50, 100);

    const conds = [
        inArray(notifications.contactId, contactIds),
        inArray(notifications.id, dispatchedNoticeIds(db)),
    ];
    if (!params.includeArchived) conds.push(isNull(notifications.archivedAt));

    const headers = await db.select({
        id: notifications.id,
        tenantId: notifications.tenantId,
        type: notifications.type,
        title: notifications.title,
        body: notifications.body,
        inspectionId: notifications.inspectionId,
        contactId: notifications.contactId,
        readAt: notifications.readAt,
        createdAt: notifications.createdAt,
    })
        .from(notifications)
        .where(and(...conds))
        .orderBy(desc(notifications.createdAt))
        .limit(limit);

    if (headers.length === 0) return [];

    const ids = headers.map((h: { id: string }) => h.id);
    const logs = await db.select({
        noticeId: automationLogs.noticeId,
        channel: automationLogs.channel,
        status: automationLogs.status,
        error: automationLogs.error,
        recipient: automationLogs.recipient,
        deliveredAt: automationLogs.deliveredAt,
        sendAt: automationLogs.sendAt,
    })
        .from(automationLogs)
        .where(inArray(automationLogs.noticeId, ids));

    const tenantIds = [...new Set(headers.map((h: { tenantId: string }) => h.tenantId))] as string[];
    const companyRows = await db.select({ id: tenants.id, name: tenants.name })
        .from(tenants)
        .where(inArray(tenants.id, tenantIds));
    const companyById = new Map<string, string>(
        companyRows.map((t: { id: string; name: string }) => [t.id, t.name]),
    );

    const byNotice = new Map<string, NoticeChannelAttempt[]>();
    for (const log of logs) {
        const key = log.noticeId as string;
        const list = byNotice.get(key) ?? [];
        list.push({
            channel: log.channel,
            status: log.status,
            reasonCode: log.error ?? null,
            recipient: log.recipient,
            deliveredAt: toMs(log.deliveredAt),
            sendAt: toMs(log.sendAt) ?? 0,
        });
        byNotice.set(key, list);
    }

    return headers.map((h: Record<string, unknown>) => ({
        id: h.id as string,
        tenantId: h.tenantId as string,
        type: h.type as string,
        title: h.title as string,
        body: (h.body ?? null) as string | null,
        inspectionId: (h.inspectionId ?? null) as string | null,
        contactId: h.contactId as string,
        companyName: companyById.get(h.tenantId as string) ?? null,
        readAt: toMs(h.readAt as Date | null),
        createdAt: toMs(h.createdAt as Date) ?? 0,
        channels: byNotice.get(h.id as string) ?? [],
    }));
}

/**
 * One notice, but only if it is the caller's. Ownership is in the WHERE rather
 * than checked after the read, so there is no window where a handler holds a
 * row it is not allowed to act on. Used by the SMS remedy, which mints an
 * opt-in token for the notice's own contact.
 */
export async function getOwnedNotice(
    db: AnyDb, contactIds: string[], id: string,
): Promise<{ id: string; tenantId: string; contactId: string } | null> {
    if (contactIds.length === 0) return null;
    const row = await db.select({
        id: notifications.id,
        tenantId: notifications.tenantId,
        contactId: notifications.contactId,
    })
        .from(notifications)
        .where(and(eq(notifications.id, id), inArray(notifications.contactId, contactIds)))
        .get();
    return row?.contactId ? { id: row.id, tenantId: row.tenantId, contactId: row.contactId } : null;
}

export async function unreadNoticeCountForContacts(db: AnyDb, contactIds: string[]): Promise<number> {
    if (contactIds.length === 0) return 0;
    const row = await db.select({ c: sql<number>`count(*)` })
        .from(notifications)
        .where(and(
            inArray(notifications.contactId, contactIds),
            // The badge counts what the reader can actually open — same
            // dispatched-only rule as the list above.
            inArray(notifications.id, dispatchedNoticeIds(db)),
            isNull(notifications.readAt),
            isNull(notifications.archivedAt),
        ))
        .get();
    return row?.c ?? 0;
}

export async function markNoticesRead(db: AnyDb, contactIds: string[], ids: string[]): Promise<void> {
    if (contactIds.length === 0 || ids.length === 0) return;
    await db.update(notifications)
        .set({ readAt: new Date() })
        .where(and(
            inArray(notifications.contactId, contactIds),
            inArray(notifications.id, ids),
            isNull(notifications.readAt),
        ));
}

export async function markAllNoticesRead(db: AnyDb, contactIds: string[]): Promise<void> {
    if (contactIds.length === 0) return;
    await db.update(notifications)
        .set({ readAt: new Date() })
        .where(and(
            inArray(notifications.contactId, contactIds),
            isNull(notifications.readAt),
        ));
}

/**
 * Delete means ARCHIVE, and it stops at the header. The ownership predicate is
 * part of the UPDATE (not a read-then-write) so a notice id belonging to
 * someone else simply matches no row.
 */
export async function archiveNotice(db: AnyDb, contactIds: string[], id: string): Promise<void> {
    if (contactIds.length === 0) return;
    await db.update(notifications)
        .set({ archivedAt: new Date() })
        .where(and(
            inArray(notifications.contactId, contactIds),
            eq(notifications.id, id),
        ));
}
