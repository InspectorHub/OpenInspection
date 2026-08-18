// server/lib/report-views.ts
/**
 * Report delivery confirmation — OI #271.
 *
 * "Did my client actually open the report?" answered without instrumenting the
 * recipient's browser. The server records its own handling of its own request:
 * three counters per (recipient, order), written when a report page is actually
 * rendered to a human who presented a live portal token.
 *
 * Nothing is stored on or read from the recipient's device — no cookie, pixel,
 * localStorage, sendBeacon or client listener — which is why ePrivacy
 * Art. 5(3) is not engaged and the lawful basis can be legitimate interests.
 * The assessment, and the eight other conditions it rests on, is
 * `docs/compliance/report-view-lia.md`. Adding any client-side signal to this
 * feature — including one meant to IMPROVE the counters' accuracy — voids it.
 *
 * This module holds the whole decision so it can be tested as a unit and so the
 * caller in `server/api/public-report.ts` stays one call wide.
 */
import { and, eq, sql } from 'drizzle-orm';
import { inspectionAccessTokens, reportViews } from './db/schema';
import type { AppDrizzle } from './route-helpers';
import { logger } from './logger';

/**
 * Everything that decides whether a request is a HUMAN READING THE REPORT.
 *
 * All of it is resolved server-side by the caller. Nothing here is taken on
 * trust from the client beyond the two prefetch hint headers, which can only
 * ever cause a request NOT to be counted.
 */
export interface ReportViewSignals {
    /**
     * The tenant's own decision, from `tenant_configs`. Default OFF.
     *
     * review B4: the legitimate-interests assessment assigned the interest to
     * the inspection company — a company that could not enable this, could not
     * disable it, and could not see it happening. A tenant's legitimate
     * interest may not be a mask for processing they cannot decline, so the
     * assessment does not hold until the decline exists. This field is it.
     */
    countingEnabled: boolean;
    /** A live per-recipient portal grant resolved for THIS inspection. */
    accessTokenId: string | null;
    /** Headless PDF pipeline (`?render=`) — the product's own non-human GET. */
    renderMode: boolean;
    /** The inspector previewing their own report from their own session. */
    ownerPreview: boolean;
    /** HTTP method of the request being served. */
    method: string;
    /** `Purpose:` request header, if any. */
    purpose?: string | null | undefined;
    /** `Sec-Purpose:` request header, if any. */
    secPurpose?: string | null | undefined;
}

/**
 * Is this request a human opening the report?
 *
 * Every clause is a way the counter would otherwise LIE to the inspector, and
 * a phantom data point about the recipient:
 *
 *  - **No recipient grant.** An owner, a render token, or nobody. There is no
 *    identified recipient to attribute an open to.
 *  - **Not a GET.** `HEAD` is what link checkers and some mail gateways issue.
 *  - **A declared prefetch/prerender.** `Purpose: prefetch` and
 *    `Sec-Purpose: prefetch`/`prerender` are the browser telling us no human
 *    has seen this yet.
 *  - **Render mode.** The headless PDF browser fetches the report page on
 *    publish, on email send, and on every PDF download — the product opening
 *    its own document, several times per order.
 *  - **Owner preview.** The inspector reading their own report is not the
 *    client receiving it, and "opened 4 times" that the inspector produced
 *    themselves is the most misleading number this feature could show.
 *
 * These are heuristics and the design says so out loud: a determined scanner
 * issues a plain `GET` and is indistinguishable from a reader (LIA §3.4(a)).
 * The remedy for that is the inspector-facing surface never presenting "opened"
 * as proof — NOT a client-side confirmation, which would move the lawful basis
 * to consent.
 */
export function shouldCountReportView(s: ReportViewSignals): boolean {
    // FIRST, before the access-token test. A tenant who has not chosen this
    // should not have the outcome depend on any other signal — the answer is no
    // because they did not ask for it, not because a header looked like a
    // prefetch. Every check below returns the same boolean, so no assertion can
    // tell the order apart; what would differ is any future branch that records
    // WHY, and a tenant who never opted in must never appear in such a record
    // as "suppressed because the link had no token".
    if (!s.countingEnabled) return false;
    if (!s.accessTokenId) return false;
    if (s.renderMode || s.ownerPreview) return false;
    if (s.method.toUpperCase() !== 'GET') return false;
    const purpose = (s.purpose ?? '').toLowerCase();
    if (purpose.includes('prefetch')) return false;
    const secPurpose = (s.secPurpose ?? '').toLowerCase();
    if (secPurpose.includes('prefetch') || secPurpose.includes('prerender')) return false;
    return true;
}

interface ReportViewRow {
    firstViewedAt: Date | null;
    lastViewedAt: Date | null;
    viewCount: number;
}

/** The counter row for one (recipient, order), or null when never opened. */
export async function getReportView(
    db: AppDrizzle,
    scope: { tenantId: string; inspectionId: string; accessTokenId: string },
): Promise<ReportViewRow | null> {
    const row = await db.select({
        firstViewedAt: reportViews.firstViewedAt,
        lastViewedAt: reportViews.lastViewedAt,
        viewCount: reportViews.viewCount,
    }).from(reportViews)
        .where(and(
            eq(reportViews.tenantId, scope.tenantId),
            eq(reportViews.inspectionId, scope.inspectionId),
            eq(reportViews.accessTokenId, scope.accessTokenId),
        ))
        .get();
    return row ?? null;
}

/**
 * GDPR Art. 21 — when this recipient objected to being measured, or null.
 *
 * The marker lives on `inspection_access_tokens` rather than in a table of its
 * own: that row is already one per (inspection, recipient) by unique index, so
 * a column there is per-recipient by construction, and it dies with the token
 * when the subject is erased.
 *
 * It is read HERE, at the increment, and nowhere else. Reading it inside
 * `resolvePortalAccess` — where it would sit tidily next to `revokedAt` and
 * `expiresAt` — turns an objection about MEASUREMENT into a withdrawal of
 * ACCESS the first time the two are confused, which is exactly the remedy the
 * LIA's amendment rejected. A recipient who objects must keep their report.
 */
export async function readViewTrackingObjection(
    db: AppDrizzle, tenantId: string, accessTokenId: string,
): Promise<number | null> {
    const row = await db.select({ at: inspectionAccessTokens.viewTrackingObjectedAt })
        .from(inspectionAccessTokens)
        .where(and(
            eq(inspectionAccessTokens.tenantId, tenantId),
            eq(inspectionAccessTokens.id, accessTokenId),
        ))
        .get();
    return row?.at ? row.at.getTime() : null;
}

/**
 * Record (or withdraw) the objection.
 *
 * Writes `view_tracking_objected_at` and NOTHING else. `revokedAt` and
 * `expiresAt` are the access columns and must never be touched from this path
 * in either direction — suppression is the whole remedy, and a recipient who
 * changes their mind gets counting back without getting a new link.
 *
 * Replay-safe by construction: objecting again keeps the ORIGINAL date rather
 * than re-stamping it. The date on record should be when the person actually
 * asked, not when their browser last retried, and a retry that quietly moved it
 * would corrupt the one fact this column exists to hold. A withdrawal clears
 * it, so a genuine second objection later gets its own honest date.
 */
export async function writeViewTrackingObjection(
    db: AppDrizzle, tenantId: string, accessTokenId: string,
    objected: boolean, now: number = Date.now(),
): Promise<number | null> {
    if (objected) {
        const existing = await readViewTrackingObjection(db, tenantId, accessTokenId);
        if (existing != null) return existing;
    }
    const at = objected ? new Date(now) : null;
    await db.update(inspectionAccessTokens)
        .set({ viewTrackingObjectedAt: at })
        .where(and(
            eq(inspectionAccessTokens.tenantId, tenantId),
            eq(inspectionAccessTokens.id, accessTokenId),
        ))
        .run();
    return at ? at.getTime() : null;
}

export type RecordOutcome = 'counted' | 'suppressed' | 'skipped';

/**
 * Count one view, unless the request is non-human or the recipient has objected.
 *
 * Never throws: a delivery-confirmation counter must not be able to fail a
 * recipient's report. A write that fails is a missing observation, which the
 * surface already has to tolerate (§3.4(a)); a 500 on the report page is not.
 */
export async function recordReportView(
    db: AppDrizzle,
    scope: { tenantId: string; inspectionId: string },
    signals: ReportViewSignals,
    now: number = Date.now(),
): Promise<RecordOutcome> {
    // Between the counter landing and the Art. 13 disclosure existing, this
    // line was preceded by a compile-time kill switch (`report-views.gate.ts`):
    // LIA §3.2 makes the disclosure load-bearing INSIDE the balancing test, so
    // a counter that ran before conditions 4, 5 and 6 ran outside its own
    // assessment. Those conditions shipped and the switch was deleted with
    // them — a flag kept past its reason becomes a second definition of whether
    // the feature exists, and the two disagree the first time someone reads
    // only one of them.
    if (!shouldCountReportView(signals)) return 'skipped';
    const accessTokenId = signals.accessTokenId as string;
    try {
        if (await readViewTrackingObjection(db, scope.tenantId, accessTokenId) != null) return 'suppressed';
        const at = new Date(now);
        await db.insert(reportViews).values({
            id: crypto.randomUUID(),
            tenantId: scope.tenantId,
            inspectionId: scope.inspectionId,
            accessTokenId,
            firstViewedAt: at,
            lastViewedAt: at,
            viewCount: 1,
        }).onConflictDoUpdate({
            target: [reportViews.tenantId, reportViews.inspectionId, reportViews.accessTokenId],
            set: {
                // `first_viewed_at` is deliberately NOT in this set — the first
                // open is the one the inspector's follow-up decision turns on,
                // and an upsert that overwrote it would silently redefine the
                // column to mean "most recent".
                lastViewedAt: at,
                // Unqualified column name: SQLite's DO UPDATE clause resolves it
                // against the conflicting row.
                viewCount: sql`view_count + 1`,
            },
        }).run();
        return 'counted';
    } catch (err) {
        logger.warn('report-views.record.failed', {
            inspectionId: scope.inspectionId.slice(0, 8),
            error: err instanceof Error ? err.message : String(err),
        });
        return 'skipped';
    }
}
