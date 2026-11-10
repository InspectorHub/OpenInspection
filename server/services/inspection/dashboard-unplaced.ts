import { INSPECTION_STATUS } from '../../lib/status/inspection-status';

/**
 * An active inspection must never fall out of every dashboard bucket.
 *
 * The date and status cuts leave gaps: a confirmed or requested visit whose date has already passed, or a
 * completed one whose report is still inside the unpublished grace period, matches none of them until it is
 * old enough for the unsigned-agreement rule. The inspections list is cut from these buckets, so such a row
 * was missing from it while `GET /api/inspections` returned it.
 *
 * Where each unplaced row goes:
 *  - a COMPLETED one (its report is simply not published yet) joins `recentReports`, the quiet bucket that
 *    already lists finished work. It is not late, so it must not raise the needs-attention count;
 *  - any other active one (a past-dated visit that was never finished) is off schedule and goes to
 *    `needsAttention`.
 * A cancelled row outside the 30-day window, and rows beyond the `later` cap, are left out on purpose.
 */
export function withUnplacedActive<T extends { id: string; status: string }>(
    all: T[], needsAttention: T[], recentReports: T[], otherBuckets: T[][],
): { needsAttention: T[]; recentReports: T[] } {
    const placed = new Set([needsAttention, recentReports, ...otherBuckets].flat().map(i => i.id));
    const unplaced = all.filter(i => i.status !== INSPECTION_STATUS.CANCELLED && !placed.has(i.id));
    return {
        needsAttention: [...needsAttention, ...unplaced.filter(i => i.status !== INSPECTION_STATUS.COMPLETED)],
        recentReports: [...recentReports, ...unplaced.filter(i => i.status === INSPECTION_STATUS.COMPLETED)],
    };
}
