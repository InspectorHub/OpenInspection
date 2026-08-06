/**
 * Which provider events become OI busy time — the Spectora one-off semantics.
 *
 * Pure decision logic on purpose. The orchestration (credentials, read set,
 * persistence) lives in `sync-engine.ts`; everything that is a RULE lives here,
 * where it can be tested without a database or a network.
 *
 * The rules, in the order they are applied:
 *
 *  2. Skip events OI itself pushed. Without this the calendar round-trips: we
 *     write an inspection to Google, read it back as "busy", and the inspector
 *     then appears unavailable for the job they are booked on. The link table
 *     is what makes an event recognisable as ours.
 *  3. Skip instances of a recurring series. `singleEvents=true` expands series
 *     into instances, so a weekly standup arrives as fifty separate busy
 *     blocks. Spectora imports one-off appointments only, and so do we in v1.
 *  6. Skip events that predate the connection. Connecting a calendar should not
 *     retroactively block months of already-accepted work. An event is "new
 *     enough" if EITHER its creation or its last modification is at/after
 *     connect — an old event moved into the window is a real change.
 *
 * Rules 4 and 5 (keyed upsert, delete-in-range) are not here: they already
 * shipped inside `syncGoogleBusyOverrides`.
 *
 * Blocks with no `externalId` come from the freeBusy endpoint, which reports
 * anonymous ranges. None of these rules can be evaluated against them, so they
 * are kept as-is — the coarse fallback stays coarse rather than silently
 * dropping to nothing.
 */
import type { BusyBlock } from './provider';

export type ImportSkipReason = 'oi_originated' | 'recurring_instance' | 'before_connect';

export interface ImportFilterResult {
    keep: BusyBlock[];
    skipped: Record<ImportSkipReason, number>;
}

export interface ImportFilterOptions {
    /** External ids this user has pushed to this provider (rule 2). */
    ownExternalIds: Set<string>;
    /** Epoch ms the connection was established (rule 6). */
    connectedAtMs: number;
}

export function filterImportableBlocks(
    blocks: BusyBlock[],
    opts: ImportFilterOptions,
): ImportFilterResult {
    const keep: BusyBlock[] = [];
    const skipped: Record<ImportSkipReason, number> = {
        oi_originated: 0,
        recurring_instance: 0,
        before_connect: 0,
    };

    for (const block of blocks) {
        // Anonymous freeBusy range — no identity to judge, so no rule applies.
        if (!block.externalId) {
            keep.push(block);
            continue;
        }
        if (opts.ownExternalIds.has(block.externalId)) {
            skipped.oi_originated++;
            continue;
        }
        if (block.recurringEventId) {
            skipped.recurring_instance++;
            continue;
        }
        // An event the provider gave no timestamps for cannot be shown to
        // predate the connection, so it is kept. Fail toward blocking time:
        // a spurious busy block is visible and correctable, a missed one
        // silently double-books the inspector.
        const touchedMs = latestTouch(block);
        if (touchedMs != null && touchedMs < opts.connectedAtMs) {
            skipped.before_connect++;
            continue;
        }
        keep.push(block);
    }

    return { keep, skipped };
}

function latestTouch(block: BusyBlock): number | null {
    const stamps = [block.createdMs, block.updatedMs].filter(
        (v): v is number => typeof v === 'number' && Number.isFinite(v),
    );
    return stamps.length ? Math.max(...stamps) : null;
}
