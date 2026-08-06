/**
 * One busy-import run for one connection.
 *
 * Extracted from the `POST /api/calendar/sync` handler so the cron sweep and
 * the manual button do the SAME thing — a sweep that drifted from the button
 * would make "click Sync now" a different feature from "sync automatically",
 * which is exactly the confusion Phase D exists to remove.
 *
 * It consumes RAW `listBusy` output rather than `mergeBusyIntervals`. Merging
 * unions overlapping ranges into anonymous blocks and throws the per-event
 * `externalId` away — and without that id none of the import rules can run:
 * OI cannot recognise its own pushed events, recurrence is invisible, and the
 * keyed upsert degrades to synthesised range keys that churn on every sync.
 */
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { tenantConfigs } from '../db/schema';
import { resolveTenantTimeZone } from '../tz';
import { logger } from '../logger';
import { syncGoogleBusyOverrides } from './sync-busy';
import { resolveReadCalendarIds } from './read-set';
import { getCalendarProvider } from './registry';
import { listOwnExternalIds } from './external-links';
import { filterImportableBlocks, type ImportSkipReason } from './google-import';
import type { CalendarConnectionRow } from './connection';
import type { BusyBlock } from './provider';

/**
 * How far ahead a sync looks. Thirty days is the shipped behaviour; the plan's
 * 90 would triple every sync's provider cost and override churn for time an
 * inspector is rarely booked into. Changing it is a product decision with a
 * measurable cost, not an implementation detail — hence a named constant.
 */
export const SYNC_WINDOW_DAYS = 30;

export interface ImportResult {
    /** Override rows written (one per surviving provider event). */
    upserted: number;
    /** Events the provider returned, before the rules ran. */
    totalEvents: number;
    skipped: Record<ImportSkipReason, number>;
}

export interface ImportDeps {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
}

/**
 * Pull one connection's busy time into `availability_overrides`.
 *
 * Throws only when the PROVIDER fails; callers decide whether that is a 500, a
 * logged cron failure, or a `last_sync_error`. Everything else is reported in
 * the result.
 */
export async function importBusyForConnection(
    db: DrizzleD1Database,
    connection: CalendarConnectionRow,
    deps: ImportDeps,
    nowMs: number = Date.now(),
): Promise<ImportResult> {
    const tenantId = connection.tenantId;
    const provider = getCalendarProvider('google');

    const from = new Date(nowMs);
    const to = new Date(nowMs + SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const readCalendarIds = await resolveReadCalendarIds(db, {
        tenantId,
        connectionId: connection.id,
        fallbackCalendarId: connection.calendarId,
    });

    const perCalendar = await Promise.all(readCalendarIds.map((calendarId) =>
        provider.listBusy({
            clientId: deps.clientId,
            clientSecret: deps.clientSecret,
            refreshToken: deps.refreshToken,
            calendarId,
            range: { from, to },
            capability: connection.capabilities,
        }),
    ));
    const blocks: BusyBlock[] = perCalendar.flat();

    const ownExternalIds = await listOwnExternalIds(db, {
        tenantId, userId: connection.userId, provider: 'google',
    });
    const connectedAtMs = connection.connectedAt instanceof Date
        ? connection.connectedAt.getTime()
        : Number(connection.connectedAt);

    const { keep, skipped } = filterImportableBlocks(blocks, {
        ownExternalIds,
        connectedAtMs: Number.isFinite(connectedAtMs) ? connectedAtMs : 0,
    });

    const tzRow = await db.select({ defaultTimezone: tenantConfigs.defaultTimezone })
        .from(tenantConfigs).where(eq(tenantConfigs.tenantId, tenantId)).get();
    const tenantTz = resolveTenantTimeZone(tzRow?.defaultTimezone);

    const { upserted } = await syncGoogleBusyOverrides(
        db,
        {
            tenantId,
            inspectorId: connection.userId,
            tenantTz,
            rangeFromMs: from.getTime(),
            rangeToMs: to.getTime(),
        },
        keep,
    );

    if (skipped.oi_originated || skipped.recurring_instance || skipped.before_connect) {
        logger.info('[calendar] import filtered provider events', { tenantId, ...skipped });
    }

    return { upserted, totalEvents: blocks.length, skipped };
}
