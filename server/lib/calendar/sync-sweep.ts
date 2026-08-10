/**
 * The cron half of calendar sync — so inspectors stop pressing "Sync now".
 *
 * It calls `importBusyForConnection`, the same function the button calls. That
 * is the point: a sweep with its own copy of the import would drift, and
 * "synced automatically" would quietly become a different feature from "synced
 * when I ask".
 *
 * Two properties this owes the rest of the system:
 *
 *  - **It never throws.** It runs inside `scheduled()` alongside unrelated
 *    jobs; one tenant's revoked Google token must not stop agreement expiry.
 *    Every failure is recorded on the connection and counted.
 *  - **It records WHY.** A stale badge cannot distinguish "nothing changed"
 *    from "we have not reached Google in three days". `last_sync_error` is the
 *    difference, and the inspector is the only one who can fix a revoked token.
 */
import { drizzle } from 'drizzle-orm/d1';
import { asc, isNull, lt, or } from 'drizzle-orm';
import { calendarConnections } from '../db/schema';
import { logger } from '../logger';
import { importBusyForConnection } from './sync-engine';
import { loadOpenCalendarConnection, markCalendarSynced, markCalendarSyncFailed } from './connection';
import { getCalendarProvider } from './registry';
import type { CalendarProviderEnv } from './provider';

export type CalendarSweepEnv = CalendarProviderEnv;

/** A connection is due when its last success is older than this. */
export const SYNC_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Ceiling per tick. The cron fires every five minutes, and each connection
 * costs at least one Google round trip per calendar in its read set — an
 * unbounded sweep would let one large tenant monopolise the invocation's
 * wall-clock budget. Stalest-first ordering means the ones skipped this tick
 * are first in line on the next.
 */
export const MAX_CONNECTIONS_PER_TICK = 25;

export interface SweepResult {
    attempted: number;
    succeeded: number;
    failed: number;
}

export async function sweepCalendarSyncs(
    env: CalendarSweepEnv,
    nowMs: number = Date.now(),
): Promise<SweepResult> {
    const db = drizzle(env.DB);
    const dueBefore = new Date(nowMs - SYNC_INTERVAL_MS);

    // Stalest first, never-synced ahead of everything. This is the fairness
    // mechanism: it spreads work across tenants without a per-tenant loop,
    // because a tenant swept this tick sorts to the back for the next.
    //
    // Every connection, whatever its provider. A `provider = 'google'` filter
    // here would mean a non-Google connection is never attempted at all — and a
    // row that is never attempted also never fails, so nothing would report it.
    const due = await db.select().from(calendarConnections)
        .where(
            or(
                isNull(calendarConnections.lastSyncAt),
                lt(calendarConnections.lastSyncAt, dueBefore),
            ),
        )
        .orderBy(asc(calendarConnections.lastSyncAt))
        .limit(MAX_CONNECTIONS_PER_TICK)
        .all();

    const result: SweepResult = { attempted: due.length, succeeded: 0, failed: 0 };

    for (const row of due) {
        try {
            // Re-open through the normal path so a connection whose credentials
            // no longer decrypt is treated as not-connected rather than as a
            // sync failure that would be retried forever.
            const open = await loadOpenCalendarConnection(
                env.DB, row.tenantId, row.userId, env.JWT_SECRET, env.JWT_SECRET_PREVIOUS,
            );
            if (!open) {
                await markCalendarSyncFailed(
                    env.DB, row.tenantId, row.userId,
                    'Calendar credentials could not be read. Reconnect Google Calendar.',
                );
                result.failed++;
                continue;
            }

            const auth = await getCalendarProvider(row.provider).resolveAuth({
                tenantId: row.tenantId, credentials: open.credentials, env,
            });
            if (!auth) {
                // A deployment-level gap, not this inspector's problem — do not
                // stamp an error they cannot act on.
                continue;
            }

            await importBusyForConnection(db, open.connection, auth, nowMs);

            await markCalendarSynced(env.DB, row.tenantId, row.userId);
            result.succeeded++;
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            result.failed++;
            try {
                await markCalendarSyncFailed(env.DB, row.tenantId, row.userId, message);
            } catch {
                // Recording the failure failed too. Nothing further to try; the
                // next tick re-attempts the sync itself.
            }
            logger.warn('[cron:calendar] connection sync failed', {
                tenantId: row.tenantId, userId: row.userId, error: message,
            });
        }
    }

    return result;
}
