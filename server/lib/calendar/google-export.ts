/**
 * Push OI work onto the assigned person's own calendar, and take it back off
 * when it moves or is cancelled.
 *
 * The provider primitives (`pushEvent` / `patchEvent` / `deleteEvent`) already
 * existed and had no callers. This module is the wiring, and it owns the three
 * decisions the primitives cannot make:
 *
 *  1. WHOSE calendar. The lead in `inspection_inspectors`, read through
 *     `getInspectionRoster` — never `inspections.inspector_id`, and never
 *     "whoever pressed the button", which is the defect that retired
 *     `POST /api/calendar/sync-events`.
 *  2. WHICH instant. `scheduled_start_ms` when the row has one, else the wall
 *     clock carried on `inspections.date` read in the tenant zone. A row with
 *     neither is SKIPPED with a reason, not given an invented 08:00 — a wrong
 *     time on someone's phone is worse than an absent entry.
 *  3. CREATE or UPDATE. `calendar_external_links` decides. A reschedule moves
 *     the entry the inspector already has rather than leaving a stale twin.
 *
 * Every entry point returns an outcome instead of throwing. Callers run this
 * detached (`waitUntil`) behind a response that has already been sent, so the
 * only useful thing a failure can do is be recorded and surfaced later.
 */
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { inspections, calendarBlocks, tenantConfigs } from '../db/schema';
import { getInspectionRoster } from '../inspection/roster';
import { resolveTenantTimeZone, wallClockToEpochMs } from '../tz';
import { logger } from '../logger';
import { canPushEvents, ExternalEventGoneError } from './provider';
import { getCalendarProvider } from './registry';
import { loadOpenGoogleConnection } from './connection';
import { loadGoogleOAuthMode, resolveGoogleOAuthCredentials } from './resolve-google-oauth';
import { getLink, upsertLink, deleteLink, type CalendarLinkEntityType } from './external-links';

/** Re-export so callers hook up against one module rather than two. */
export type CalendarLinkEntityTypeAlias = CalendarLinkEntityType;

export interface CalendarExportEnv {
    DB: D1Database;
    TENANT_CACHE: KVNamespace;
    JWT_SECRET: string;
    JWT_SECRET_PREVIOUS?: string;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
}

/**
 * Why a push did not happen. Every one of these is a state a user can be in
 * and can act on, which is why they are named rather than logged as a boolean.
 */
export type PushSkipReason =
    | 'NOT_CONNECTED'
    | 'NO_WRITE_CAPABILITY'
    | 'OAUTH_NOT_CONFIGURED'
    | 'NO_ASSIGNEE'
    | 'NO_START_TIME'
    | 'NOT_FOUND'
    | 'CANCELLED'
    | 'PUSH_FAILED';

export interface PushOutcome {
    pushed: boolean;
    reason?: PushSkipReason;
    externalId?: string;
    /** Provider message when reason is PUSH_FAILED — surfaced as last_sync_error. */
    error?: string;
}

/**
 * Fallback span for an inspection carrying no end and no duration. Three hours
 * is the same figure the booking path uses for a specific-time slot, so a
 * hand-created inspection and a booked one look the same on a calendar. It is a
 * named constant precisely because the retired push hid a 30-minute guess.
 */
const DEFAULT_DURATION_MIN = 180;

const PROVIDER = 'google' as const;

async function tenantTimeZone(db: DrizzleD1Database, tenantId: string): Promise<string> {
    const row = await db.select({ defaultTimezone: tenantConfigs.defaultTimezone })
        .from(tenantConfigs).where(eq(tenantConfigs.tenantId, tenantId)).get();
    return resolveTenantTimeZone(row?.defaultTimezone);
}

const toMs = (v: unknown): number | null =>
    v instanceof Date ? v.getTime() : v == null ? null : Number(v);

/**
 * The instant an inspection starts, most authoritative first.
 *
 * Production currently holds no rows with a non-NULL `scheduled_start_ms`, so
 * the second rung is not a theoretical fallback — it is the one that runs.
 */
function resolveStartMs(
    row: { date: string; scheduledStartMs: unknown },
    tz: string,
): number | null {
    const stamped = toMs(row.scheduledStartMs);
    if (stamped != null && Number.isFinite(stamped)) return stamped;
    // `date` is either a bare civil day or a day with an HH:MM suffix. Only the
    // latter names a time; a bare day genuinely does not know when it starts.
    const hm = row.date.length > 10 ? row.date.slice(11, 16) : null;
    if (!hm || !/^\d{2}:\d{2}$/.test(hm)) return null;
    return wallClockToEpochMs(row.date.slice(0, 10), hm, tz);
}

interface WriteHandle {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    calendarId: string;
}

/**
 * The credentials and write target for one user, or the reason there are none.
 * `availability_read` connections are refused here rather than at each call
 * site, so read-only consent can never become a write.
 */
async function resolveWriteHandle(
    env: CalendarExportEnv,
    tenantId: string,
    userId: string,
): Promise<{ handle: WriteHandle } | { reason: PushSkipReason }> {
    const open = await loadOpenGoogleConnection(
        env.DB, tenantId, userId, env.JWT_SECRET, env.JWT_SECRET_PREVIOUS,
    );
    if (!open) return { reason: 'NOT_CONNECTED' };
    if (!canPushEvents(open.connection.capabilities)) return { reason: 'NO_WRITE_CAPABILITY' };
    const mode = await loadGoogleOAuthMode(env.DB, tenantId);
    const creds = await resolveGoogleOAuthCredentials(env, tenantId, mode);
    if (!creds) return { reason: 'OAUTH_NOT_CONFIGURED' };
    return {
        handle: {
            clientId: creds.clientId,
            clientSecret: creds.clientSecret,
            refreshToken: open.credentials.refreshToken,
            // Single-write: the read set is for busy import; the write always
            // goes to the connection's nominated calendar.
            calendarId: open.connection.calendarId,
        },
    };
}

interface EventShape {
    summary: string;
    location?: string;
    description?: string;
    start: Date;
    end: Date;
    timeZone: string;
}

/**
 * Create-or-update against the link table, repairing a link whose remote event
 * the owner deleted by hand.
 */
async function writeThroughLink(
    env: CalendarExportEnv,
    db: DrizzleD1Database,
    handle: WriteHandle,
    key: { tenantId: string; entityType: CalendarLinkEntityType; entityId: string },
    userId: string,
    event: EventShape,
): Promise<PushOutcome> {
    const provider = getCalendarProvider(PROVIDER);
    const linkKey = { ...key, provider: PROVIDER };
    const existing = await getLink(db, linkKey);

    // A reassignment leaves the entry on the PREVIOUS person's calendar. Take
    // it off THERE — with that person's credentials and their write calendar,
    // which is what deleteExternalForEntity resolves from the link row. Deleting
    // with the incoming lead's handle would aim at the wrong calendar entirely.
    if (existing && existing.userId !== userId) {
        await deleteExternalForEntity(env, key.tenantId, key.entityType, key.entityId);
    }

    if (existing && existing.userId === userId) {
        try {
            await provider.patchEvent({ ...handle, externalId: existing.externalId, event });
            await upsertLink(db, { ...linkKey, userId, externalId: existing.externalId });
            return { pushed: true, externalId: existing.externalId };
        } catch (e) {
            if (!(e instanceof ExternalEventGoneError)) {
                return { pushed: false, reason: 'PUSH_FAILED', error: e instanceof Error ? e.message : String(e) };
            }
            // Fall through to a fresh create — the link was stale.
            logger.info('[calendar] external event gone, recreating', { entityId: key.entityId });
        }
    }

    try {
        const externalId = await provider.pushEvent({ ...handle, event });
        await upsertLink(db, { ...linkKey, userId, externalId });
        return { pushed: true, externalId };
    } catch (e) {
        return { pushed: false, reason: 'PUSH_FAILED', error: e instanceof Error ? e.message : String(e) };
    }
}

/**
 * Put one inspection on its lead inspector's calendar, or move/remove it to
 * match the inspection's current state.
 */
export async function pushInspectionToGoogle(
    env: CalendarExportEnv,
    tenantId: string,
    inspectionId: string,
): Promise<PushOutcome> {
    const db = drizzle(env.DB);
    const row = await db.select({
        date: inspections.date,
        scheduledStartMs: inspections.scheduledStartMs,
        scheduledEndMs: inspections.scheduledEndMs,
        durationMin: inspections.durationMin,
        propertyAddress: inspections.propertyAddress,
        status: inspections.status,
    })
        .from(inspections)
        .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)))
        .get();
    if (!row) return { pushed: false, reason: 'NOT_FOUND' };

    const roster = await getInspectionRoster(db, tenantId, inspectionId);
    const lead = roster.lead;

    // Cancelled or unassigned: the entry should not be on anyone's calendar.
    if (row.status === 'cancelled' || !lead) {
        await deleteExternalForEntity(env, tenantId, 'inspection', inspectionId);
        return { pushed: false, reason: row.status === 'cancelled' ? 'CANCELLED' : 'NO_ASSIGNEE' };
    }

    const resolved = await resolveWriteHandle(env, tenantId, lead.id);
    if ('reason' in resolved) return { pushed: false, reason: resolved.reason };

    const tz = await tenantTimeZone(db, tenantId);
    const startMs = resolveStartMs(row, tz);
    if (startMs == null) return { pushed: false, reason: 'NO_START_TIME' };

    const endStamp = toMs(row.scheduledEndMs);
    const endMs = endStamp != null && endStamp > startMs
        ? endStamp
        : startMs + (row.durationMin ?? DEFAULT_DURATION_MIN) * 60_000;

    return writeThroughLink(
        env, db, resolved.handle,
        { tenantId, entityType: 'inspection', entityId: inspectionId },
        lead.id,
        {
            summary: `Inspection: ${row.propertyAddress}`,
            location: row.propertyAddress,
            start: new Date(startMs),
            end: new Date(endMs),
            timeZone: tz,
        },
    );
}

/**
 * Put one time-off / blocked-time row on its owner's calendar. Blocks carry
 * civil times, so the instant is composed in the tenant zone; an all-day block
 * spans the tenant's working window rather than a UTC midnight-to-midnight,
 * which would land on the wrong day west of Greenwich.
 */
export async function pushBlockToGoogle(
    env: CalendarExportEnv,
    tenantId: string,
    blockId: string,
): Promise<PushOutcome> {
    const db = drizzle(env.DB);
    const row = await db.select().from(calendarBlocks)
        .where(and(eq(calendarBlocks.id, blockId), eq(calendarBlocks.tenantId, tenantId)))
        .get();
    if (!row) return { pushed: false, reason: 'NOT_FOUND' };

    const resolved = await resolveWriteHandle(env, tenantId, row.userId);
    if ('reason' in resolved) return { pushed: false, reason: resolved.reason };

    const tz = await tenantTimeZone(db, tenantId);
    const startHm = row.allDay ? '00:00' : (row.startTime ?? '00:00');
    const endHm = row.allDay ? '23:59' : (row.endTime ?? '23:59');
    const startMs = wallClockToEpochMs(row.date, startHm, tz);
    const endMs = wallClockToEpochMs(row.date, endHm, tz);

    return writeThroughLink(
        env, db, resolved.handle,
        { tenantId, entityType: 'calendar_block', entityId: blockId },
        row.userId,
        {
            summary: row.title,
            ...(row.notes ? { description: row.notes } : {}),
            start: new Date(startMs),
            end: new Date(endMs > startMs ? endMs : startMs + 60_000),
            timeZone: tz,
        },
    );
}

/**
 * Remove the remote event for one OI entity and forget the link.
 *
 * The link row is dropped even when the provider call fails. Keeping it would
 * mean the next push tries to PATCH an event the owner cannot see, forever;
 * dropping it means the worst case is one orphaned entry the owner can delete,
 * and OI's next push creates a clean one.
 */
export async function deleteExternalForEntity(
    env: CalendarExportEnv,
    tenantId: string,
    entityType: CalendarLinkEntityType,
    entityId: string,
): Promise<void> {
    const db = drizzle(env.DB);
    const linkKey = { tenantId, provider: PROVIDER, entityType, entityId };
    const link = await getLink(db, linkKey);
    if (!link) return;

    const resolved = await resolveWriteHandle(env, tenantId, link.userId);
    if (!('reason' in resolved)) {
        try {
            await getCalendarProvider(PROVIDER).deleteEvent({
                ...resolved.handle, externalId: link.externalId,
            });
        } catch (e) {
            logger.warn('[calendar] remote delete failed; dropping link anyway', {
                tenantId, entityId, error: e instanceof Error ? e.message : String(e),
            });
        }
    }
    await deleteLink(db, linkKey);
}
