import { and, eq, gte, lte } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { availabilityOverrides } from '../db/schema';
import { epochMsToRfc3339 } from '../tz';
import type { BusyBlock, CalendarProviderId } from './provider';

/**
 * The providers `availability_overrides.source` admits. Narrower than
 * `CalendarProviderId` on purpose: only a provider that can actually sync busy
 * time may stamp provenance on an override row.
 */
export type BusyOverrideSource = 'google' | 'apple';

export function isBusyOverrideSource(id: CalendarProviderId): id is BusyOverrideSource {
    return id === 'google' || id === 'apple';
}

/**
 * A-polish 10.3 — persist a provider's busy blocks as timed availability_overrides.
 *
 * Each block (an instant range) is converted to the tenant's civil date +
 * wall-clock start/end in the tenant timezone, so downstream slot computation
 * reasons in local time. Stale rows FROM THE SAME SOURCE in the synced
 * civil-date range are deleted first, then blocks are upserted keyed on
 * (inspector_id, source, external_id) — so a re-sync updates in place rather
 * than duplicating. Transparent (free) blocks are stored for provenance but the
 * slot map skips them (see buildTenantSlotMap).
 *
 * Manual overrides (source IS NULL) are never touched, and neither is any
 * OTHER provider's picture: the delete is scoped to `source`, so one provider's
 * sync can never clear another's rows.
 */
export async function syncProviderBusyOverrides(
    db: DrizzleD1Database,
    params: {
        tenantId: string;
        inspectorId: string;
        tenantTz: string;
        rangeFromMs: number;
        rangeToMs: number;
        /** Which provider's picture this run owns. */
        source: BusyOverrideSource;
    },
    blocks: BusyBlock[],
): Promise<{ upserted: number }> {
    const { tenantId, inspectorId, tenantTz, rangeFromMs, rangeToMs, source } = params;
    const minDate = epochMsToRfc3339(rangeFromMs, tenantTz).slice(0, 10);
    const maxDate = epochMsToRfc3339(rangeToMs, tenantTz).slice(0, 10);

    // Clear this source's previous picture for this range so events that
    // vanished from the calendar stop blocking.
    await db.delete(availabilityOverrides).where(and(
        eq(availabilityOverrides.tenantId, tenantId),
        eq(availabilityOverrides.inspectorId, inspectorId),
        eq(availabilityOverrides.source, source),
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
            source,
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
