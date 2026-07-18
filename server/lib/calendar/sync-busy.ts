import { and, eq, gte, lte } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { availabilityOverrides } from '../db/schema';
import { epochMsToRfc3339 } from '../tz';
import type { BusyBlock } from './provider';

/**
 * A-polish 10b.4 — union busy time across the multi-read calendar set. Drops
 * transparent (free) events, then merges overlapping/adjacent [start, end)
 * ranges into a minimal set of unioned busy blocks. The merged blocks are
 * anonymous (opaque, no event id) — the sync helper synthesizes a stable id
 * from the range, so a re-sync is idempotent.
 */
export function mergeBusyIntervals(blocks: BusyBlock[]): BusyBlock[] {
    const ranges = blocks
        .filter((b) => b.transparency !== 'transparent')
        .map((b) => ({ startMs: new Date(b.start).getTime(), endMs: new Date(b.end).getTime(), start: b.start, end: b.end }))
        .filter((b) => Number.isFinite(b.startMs) && Number.isFinite(b.endMs) && b.endMs > b.startMs)
        .sort((a, b) => a.startMs - b.startMs);

    const merged: BusyBlock[] = [];
    let cur: { startMs: number; endMs: number; start: string; end: string } | null = null;
    for (const r of ranges) {
        if (!cur) {
            cur = { ...r };
        } else if (r.startMs <= cur.endMs) {
            // Overlapping or touching → extend the current union.
            if (r.endMs > cur.endMs) {
                cur.endMs = r.endMs;
                cur.end = r.end;
            }
        } else {
            merged.push({ start: cur.start, end: cur.end, transparency: 'opaque' });
            cur = { ...r };
        }
    }
    if (cur) merged.push({ start: cur.start, end: cur.end, transparency: 'opaque' });
    return merged;
}

/**
 * A-polish 10.3 — persist a provider's busy blocks as timed availability_overrides.
 *
 * Each block (an instant range) is converted to the tenant's civil date +
 * wall-clock start/end in the tenant timezone, so downstream slot computation
 * reasons in local time. Stale google-sourced rows in the synced civil-date
 * range are deleted first, then blocks are upserted keyed on
 * (inspector_id, source, external_id) — so a re-sync updates in place rather
 * than duplicating. Transparent (free) blocks are stored for provenance but the
 * slot map skips them (see buildTenantSlotMap).
 *
 * Manual overrides (source IS NULL) are never touched.
 */
export async function syncGoogleBusyOverrides(
    db: DrizzleD1Database,
    params: {
        tenantId: string;
        inspectorId: string;
        tenantTz: string;
        rangeFromMs: number;
        rangeToMs: number;
    },
    blocks: BusyBlock[],
): Promise<{ upserted: number }> {
    const { tenantId, inspectorId, tenantTz, rangeFromMs, rangeToMs } = params;
    const minDate = epochMsToRfc3339(rangeFromMs, tenantTz).slice(0, 10);
    const maxDate = epochMsToRfc3339(rangeToMs, tenantTz).slice(0, 10);

    // Clear the previous google-sourced picture for this range so events that
    // vanished from the calendar stop blocking.
    await db.delete(availabilityOverrides).where(and(
        eq(availabilityOverrides.tenantId, tenantId),
        eq(availabilityOverrides.inspectorId, inspectorId),
        eq(availabilityOverrides.source, 'google'),
        gte(availabilityOverrides.date, minDate),
        lte(availabilityOverrides.date, maxDate),
    ));

    let upserted = 0;
    for (const block of blocks) {
        const startMs = new Date(block.start).getTime();
        const endMs = new Date(block.end).getTime();
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;

        const startLocal = epochMsToRfc3339(startMs, tenantTz);
        const endLocal = epochMsToRfc3339(endMs, tenantTz);
        const date = startLocal.slice(0, 10);
        const startTime = startLocal.slice(11, 16);
        const endTime = endLocal.slice(11, 16);
        // freeBusy blocks carry no event id; synthesize a stable key from the range.
        const externalId = block.externalId ?? `fb:${block.start}:${block.end}`;
        const transparency = block.transparency ?? 'opaque';

        await db.insert(availabilityOverrides).values({
            id: crypto.randomUUID(),
            tenantId,
            inspectorId,
            date,
            isAvailable: false,
            startTime,
            endTime,
            source: 'google',
            externalId,
            transparency,
            createdAt: new Date(),
        }).onConflictDoUpdate({
            target: [
                availabilityOverrides.inspectorId,
                availabilityOverrides.source,
                availabilityOverrides.externalId,
            ],
            set: { date, startTime, endTime, transparency },
        });
        upserted++;
    }
    return { upserted };
}
