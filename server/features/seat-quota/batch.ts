import { Errors } from '../../lib/errors';
import type { SeatUsage } from './usage';

/**
 * How many NEW seats a staged batch would consume.
 *
 * Rows that clash with somebody who is already a member (or already holds an
 * outstanding invite) are skipped by the apply path and cost nothing, so they
 * are not counted. Counting them would refuse a re-import of a mostly
 * unchanged staff list.
 */
export function computeSeatsNeeded(rows: { entity: string; conflictWith: string | null }[]): number {
    return rows.filter((r) => r.entity === 'member' && r.conflictWith === null).length;
}

/**
 * Refuse the WHOLE batch when there are not enough seats, before anything has
 * been written.
 *
 * Deliberately not the single-seat middleware: that one is a door for one
 * person, and asking it twelve times in a row would let the first three
 * through and leave the rest as a state nobody can read off the screen — some
 * people invited, some silently not. Staging has written nothing to a real
 * table at this point, so refusing costs the operator a second choice and
 * nothing else.
 *
 * `usage.remaining` is measured against seats HELD, so invitations already
 * outstanding are part of what the batch is competing with — otherwise a batch
 * would be admitted against headroom that a previous batch's unaccepted
 * invitations have already spoken for.
 */
export function assertBatchSeatsAvailable(args: {
    needed: number;
    usage: SeatUsage;
    enforced: boolean;
    billingPortalUrl: string | null;
}): void {
    if (!args.enforced) return;
    if (args.usage.max === null) return;
    if (args.needed <= args.usage.remaining) return;
    throw Errors.SeatLimitReached({
        used: args.usage.used,
        max: args.usage.max,
        billingPortalUrl: args.billingPortalUrl,
        needed: args.needed,
    });
}
