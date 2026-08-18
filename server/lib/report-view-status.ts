/**
 * What the inspector is allowed to be told about a report reaching its
 * recipient — OI #271, LIA condition 6.
 *
 * `docs/compliance/report-view-lia.md` §3.4(a) turns two things from good
 * practice into CONDITIONS, and this module is where both are decided:
 *
 *  - **"Opened" is never proof.** The filters in `report-views.ts` are
 *    heuristics; a determined mail-security scanner issues a plain `GET` and is
 *    indistinguishable from a reader. The counters go out as counters, and the
 *    surface that renders them says so.
 *  - **"Not opened" must be paired with delivery status.** An unopened report
 *    is ambiguous — the link may be sitting unread, or nothing may have left
 *    the building. Presenting the two as one state is how an inspector ends up
 *    chasing a client about a report that was never sent.
 *
 * ## Why there are THREE states and not two
 *
 * A notice with a future `send_at` is deliberately invisible in the Outbox
 * (`getCommunicationDeliveries` filters `send_at <= now`, because a "pending"
 * row dated tomorrow reads as a failure rather than as a plan). It is also
 * genuinely NOT SENT. Folding it into "delivered, not opened" would make the
 * product state something false about a recipient who has had no chance to open
 * anything, which is the precise harm condition 6 exists to prevent — so
 * `queued` carries no open status at all, because none is possible.
 *
 * ## Scope: the ORDER, never the deliverable
 *
 * `report_views` is keyed `(tenant, inspection, access_token)` and carries no
 * `report_id`, because the public renderer has no report identity (LIA §3.4(b),
 * option 3). So these rows say "this recipient opened the report page for this
 * order". They must NOT be hung off a single deliverable in the UI: attributing
 * an order-scoped open to "the radon report" is the wrong attribution §3.4(b)
 * rejects on accuracy, and it would be a UI decision that quietly overrides a
 * schema decision made to avoid exactly it.
 *
 * ## What is NOT here
 *
 * No chart, no trend, no per-recipient ranking, no "engagement". The LIA's
 * purpose test (§1) passes for the delivery question and explicitly for nothing
 * else; a visualisation is a different purpose and would need its own
 * assessment before it could be built.
 */
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import {
    automationLogs, automations, contactRoleProfiles, inspectionAccessTokens, reportViews,
} from './db/schema';
import type { AppDrizzle } from './route-helpers';

/**
 * The automation triggers whose notices hand over a report link.
 *
 * Manual sends are included by a different rule (see the query): the ledger's
 * manual marker is `automation_id IS NULL`, and the ONLY caller of
 * `makeManualSendLogger` is the report-delivery route — so on this table a
 * manual row IS a report send. If a second manual-send path ever appears, this
 * is the assumption that breaks, and
 * `tests/unit/client-portal/report-link-status.spec.ts` is where it will say
 * so.
 */
const REPORT_LINK_TRIGGERS = ['report.published', 'report.amended'] as const;

export type ReportLinkState = 'queued' | 'delivered' | 'opened';

export interface ReportLinkStatus {
    /** `inspection_access_tokens.id` — the recipient, as the counter keys them. */
    accessTokenId: string;
    recipient: string;
    roleKey: string | null;
    roleLabel: string | null;
    state: ReportLinkState;
    /** Epoch-ms the notice is due to go out. Only meaningful for `queued`. */
    scheduledAt: number | null;
    /** Epoch-ms the most recent report notice actually went out. */
    sentAt: number | null;
    viewCount: number;
    firstViewedAt: number | null;
    lastViewedAt: number | null;
    /**
     * Art. 21 — this recipient asked not to be measured, so the counter is
     * suppressed for them. It rides the row because without it "not yet opened"
     * is a false statement about someone who may well have read the report:
     * the number is zero because we stopped counting, not because nothing
     * happened.
     */
    trackingObjected: boolean;
}

/**
 * Which of the three states a recipient is in.
 *
 * view-invariant: no-secondary-use - these counters answer one question for the
 * inspector who sent the report ("did it get opened?") and are read nowhere
 * else. No marketing, lead scoring, segmentation, ranking or model training may
 * consume them; a second purpose is a second lawful basis, not a new query.
 *
 * Precedence is opened > delivered > queued, and it is not arbitrary: a
 * recipient with an old delivered notice AND a scheduled amendment has already
 * had the report, so "scheduled to send" would be the less true of the two.
 */
export function reportLinkState(input: {
    viewCount: number; sentAt: number | null; scheduledAt: number | null;
}): ReportLinkState {
    if (input.viewCount > 0) return 'opened';
    if (input.sentAt != null) return 'delivered';
    return 'queued';
}

interface LogFact { sentAt: number | null; scheduledAt: number | null }

/** Fold one recipient's notice rows into "last sent" and "next due". */
export function foldReportNotices(
    rows: Array<{ sendAt: number; status: string }>,
    now: number,
): LogFact {
    let sentAt: number | null = null;
    let scheduledAt: number | null = null;
    for (const r of rows) {
        if (r.sendAt > now) {
            // Earliest future firing: what the inspector is waiting on.
            if (scheduledAt == null || r.sendAt < scheduledAt) scheduledAt = r.sendAt;
            continue;
        }
        // Only `sent` counts as delivered. A due row that failed or was skipped
        // is exactly the case the inspector must be able to tell apart from an
        // unread inbox, and the Outbox beside this list is where the reason is.
        if (r.status !== 'sent') continue;
        if (sentAt == null || r.sendAt > sentAt) sentAt = r.sendAt;
    }
    return { sentAt, scheduledAt };
}

const ms = (v: Date | number | null | undefined): number | null =>
    v == null ? null : (v instanceof Date ? v.getTime() : Number(v));

/**
 * One row per report-link recipient of this order who has something to report:
 * a notice out, a notice due, or an open on record. A recipient whose token was
 * issued but who was never sent anything is omitted — there is no delivery
 * question about them yet.
 */
export async function listReportLinkStatus(
    db: AppDrizzle,
    tenantId: string,
    inspectionId: string,
    now: number = Date.now(),
): Promise<ReportLinkStatus[]> {
    const tokens = await db.select({
        id: inspectionAccessTokens.id,
        recipientEmail: inspectionAccessTokens.recipientEmail,
        role: inspectionAccessTokens.role,
        objectedAt: inspectionAccessTokens.viewTrackingObjectedAt,
    }).from(inspectionAccessTokens)
        .where(and(
            eq(inspectionAccessTokens.tenantId, tenantId),
            eq(inspectionAccessTokens.inspectionId, inspectionId),
        ));
    if (tokens.length === 0) return [];

    const [views, logs, roleRows] = await Promise.all([
        db.select({
            accessTokenId: reportViews.accessTokenId,
            viewCount: reportViews.viewCount,
            firstViewedAt: reportViews.firstViewedAt,
            lastViewedAt: reportViews.lastViewedAt,
        }).from(reportViews)
            .where(and(
                eq(reportViews.tenantId, tenantId),
                eq(reportViews.inspectionId, inspectionId),
            )),
        // Report notices only: an automation whose trigger hands over a report
        // link, or a manual send (see REPORT_LINK_TRIGGERS' note). Email only —
        // the log's `recipient` holds a phone for SMS rows, which cannot be
        // matched to a token's email, and every report-link notice class
        // declares `channels: ['email']` today.
        db.select({
            recipient: automationLogs.recipient,
            sendAt: automationLogs.sendAt,
            status: automationLogs.status,
        }).from(automationLogs)
            .leftJoin(automations, and(
                eq(automations.tenantId, automationLogs.tenantId),
                eq(automations.id, automationLogs.automationId),
            ))
            .where(and(
                eq(automationLogs.tenantId, tenantId),
                eq(automationLogs.inspectionId, inspectionId),
                eq(automationLogs.channel, 'email'),
                or(
                    isNull(automationLogs.automationId),
                    inArray(automations.trigger, [...REPORT_LINK_TRIGGERS]),
                ),
            )),
        db.select({ key: contactRoleProfiles.key, label: contactRoleProfiles.label })
            .from(contactRoleProfiles)
            .where(and(
                eq(contactRoleProfiles.tenantId, tenantId),
                eq(contactRoleProfiles.active, true),
            )),
    ]);

    const viewByToken = new Map(views.map((v) => [v.accessTokenId, v]));
    const labelByKey = new Map(roleRows.map((r) => [r.key, r.label]));
    const logsByEmail = new Map<string, Array<{ sendAt: number; status: string }>>();
    for (const l of logs) {
        const key = l.recipient.trim().toLowerCase();
        const list = logsByEmail.get(key) ?? [];
        list.push({ sendAt: ms(l.sendAt) ?? 0, status: l.status });
        logsByEmail.set(key, list);
    }

    const out: ReportLinkStatus[] = [];
    for (const t of tokens) {
        const view = viewByToken.get(t.id);
        const fact = foldReportNotices(logsByEmail.get(t.recipientEmail.trim().toLowerCase()) ?? [], now);
        const viewCount = view?.viewCount ?? 0;
        if (viewCount === 0 && fact.sentAt == null && fact.scheduledAt == null) continue;
        out.push({
            accessTokenId: t.id,
            recipient: t.recipientEmail,
            roleKey: t.role ?? null,
            roleLabel: (t.role ? labelByKey.get(t.role) : null) ?? null,
            state: reportLinkState({ viewCount, sentAt: fact.sentAt, scheduledAt: fact.scheduledAt }),
            scheduledAt: fact.scheduledAt,
            sentAt: fact.sentAt,
            viewCount,
            firstViewedAt: ms(view?.firstViewedAt),
            lastViewedAt: ms(view?.lastViewedAt),
            trackingObjected: t.objectedAt != null,
        });
    }
    // Sent/scheduled newest first, then by address so the order is stable when
    // a batch shares one timestamp.
    return out.sort((a, b) =>
        (b.sentAt ?? b.scheduledAt ?? 0) - (a.sentAt ?? a.scheduledAt ?? 0)
        || a.recipient.localeCompare(b.recipient));
}
