/**
 * What a cancellation costs, and what goes back.
 *
 * Pure — no DB, no clock, no side effects. This is the piece a tenant will
 * dispute, so it has to read as a table of cases, and it has to be testable
 * without a database in the room. Nothing here executes a refund: it computes
 * an outcome and the ledger records it.
 *
 * ON EPOCH ARITHMETIC AND TIMEZONES. The notice threshold is in HOURS between
 * two instants, and for that, subtracting epoch milliseconds is exactly right —
 * an hour is an hour across a DST boundary, and no timezone enters the
 * calculation. The timezone hazard is precisely why CALENDAR days are not
 * shipped: "2 business days", the other phrasing every published policy uses,
 * needs the tenant's zone, a weekend rule and a holiday list. Two of those
 * exist here and one does not, so v1 is hours only.
 *
 * ON THE FEE BASE. A percentage fee is of the inspection PRICE, but only what
 * was actually COLLECTED can be kept. Those are different numbers whenever a
 * deposit is involved, and conflating them invents a receivable nobody agreed
 * to: a 100% no-show fee against a 20% deposit must charge the deposit, not
 * bill the client for the other 80%.
 */
import type { CancellationFee, CancellationPolicy } from './cancellation-policy';

/** Who ended the appointment. Not the same axis as what happened. */
export type CancellationInitiator = 'client' | 'inspector';

/** What happened. A no-show is an event, not an actor. */
export type CancellationEvent = 'cancellation' | 'no_show';

/**
 * Why the outcome is what it is. A CODE, not prose: this crosses the wire to a
 * UI that has to render it in the reader's language, and an English sentence
 * baked in here would be untranslatable by construction.
 */
export type CancellationReasonCode =
    /** The company cancelled. Always a full refund; not configurable. */
    | 'inspector_initiated'
    /** No ladder configured. The platform charges nothing. */
    | 'no_policy'
    /** No precise scheduled instant on the order, so notice cannot be measured. */
    | 'no_scheduled_instant'
    | 'sufficient_notice'
    | 'late_cancellation'
    | 'no_show';

export interface CancellationInput {
    policy: CancellationPolicy | null;
    /**
     * The instant the work was due to begin (`inspections.scheduled_start_ms`).
     * NULL on legacy and manually-created orders — see the fail-closed rule.
     */
    scheduledAt: Date | number | null;
    now: Date | number;
    /** The agreed price of the work. A PERCENT fee is a share of THIS. */
    priceCents: number;
    /** What was actually collected. Only this can be kept, and only this refunded. */
    paidCents: number;
    initiator: CancellationInitiator;
    event: CancellationEvent;
}

export interface CancellationOutcome {
    /** Kept by the tenant. Never exceeds `paidCents`. */
    feeCents: number;
    /** Returned to the payer. Always `paidCents - feeCents`. */
    refundCents: number;
    reason: CancellationReasonCode;
    /**
     * The ladder asked for more than was collected and the charge was reduced
     * to what there was. Worth surfacing: the tenant is owed less than their
     * own policy says, and they should find that out here rather than from a
     * reconciliation three weeks later.
     */
    cappedAtCollected: boolean;
}

const MS_PER_HOUR = 3_600_000;

const asMs = (t: Date | number): number => (t instanceof Date ? t.getTime() : t);

/** A fee rung resolved against the price. Rounded to whole cents. */
function feeAgainstPrice(fee: CancellationFee, priceCents: number): number {
    if (fee.type === 'fixed') return Math.max(0, Math.round(fee.amountCents));
    return Math.max(0, Math.round((priceCents * fee.percent) / 100));
}

export function resolveCancellation(input: CancellationInput): CancellationOutcome {
    const { policy, priceCents, paidCents, initiator, event } = input;

    const free = (reason: CancellationReasonCode): CancellationOutcome => ({
        feeCents: 0,
        refundCents: paidCents,
        reason,
        cappedAtCollected: false,
    });

    // A policy that penalises a client for the company's own cancellation is
    // the one outcome no published policy permits. Checked FIRST, before the
    // ladder is even consulted, so no configuration can reach it.
    if (initiator === 'inspector') return free('inspector_initiated');

    // Ships this way for every workspace: no ladder, no charge.
    if (!policy) return free('no_policy');

    if (event === 'no_show') return charge(policy.noShowFee, 'no_show');

    // Fail closed. Without a precise scheduled instant there is no honest
    // answer to "how much notice was that", and the wrong direction to guess is
    // the one that charges someone.
    if (input.scheduledAt == null) return free('no_scheduled_instant');

    const hoursOfNotice = (asMs(input.scheduledAt) - asMs(input.now)) / MS_PER_HOUR;
    if (hoursOfNotice >= policy.noticeHours) return free('sufficient_notice');

    return charge(policy.lateFee, 'late_cancellation');

    function charge(fee: CancellationFee, reason: CancellationReasonCode): CancellationOutcome {
        const wanted = feeAgainstPrice(fee, priceCents);
        const feeCents = Math.min(wanted, Math.max(0, paidCents));
        return {
            feeCents,
            refundCents: Math.max(0, paidCents) - feeCents,
            reason,
            cappedAtCollected: wanted > feeCents,
        };
    }
}
