import { drizzle } from 'drizzle-orm/d1';
import { and, asc, eq } from 'drizzle-orm';
import { logger } from '../logger';
import { calendarConnections } from '../db/schema/calendar';
import type { CalendarCapability, CalendarProviderId } from './provider';
import {
    openCredentials,
    sealCredentials,
    type CalendarCredentialPayload,
    type SealedCalendarCredentials,
} from './credentials';

export type CalendarConnectionRow = typeof calendarConnections.$inferSelect;

export interface OpenCalendarConnection {
    connection: CalendarConnectionRow;
    /**
     * The decrypted payload as stored — a union, never cast to the OAuth
     * member. Only the provider that owns this connection may look inside.
     */
    credentials: CalendarCredentialPayload;
}

const OAUTH_KV_PREFIX = 'cal-oauth:';
export const CALENDAR_OAUTH_TTL_SEC = 600;

export function calendarOAuthKvKey(state: string): string {
    return `${OAUTH_KV_PREFIX}${state}`;
}

export interface PendingCalendarOAuth {
    userId: string;
    tenantId: string;
    verifier: string;
    capability: CalendarCapability;
    provider: CalendarProviderId;
}

/**
 * One user's calendar connection. `provider` omitted means ANY provider — a
 * default of `'google'` is the same bug as a literal, only harder to grep for.
 *
 * Ordering is `connectedAt` then `id` so the "any provider" read can never be a
 * coin flip between two rows.
 */
export async function getCalendarConnection(
    db: D1Database,
    tenantId: string,
    userId: string,
    provider?: CalendarProviderId,
): Promise<CalendarConnectionRow | null> {
    const drizzleDb = drizzle(db);
    const rows = await drizzleDb
        .select()
        .from(calendarConnections)
        .where(and(
            eq(calendarConnections.tenantId, tenantId),
            eq(calendarConnections.userId, userId),
            ...(provider ? [eq(calendarConnections.provider, provider)] : []),
        ))
        .orderBy(asc(calendarConnections.connectedAt), asc(calendarConnections.id))
        .limit(1);
    return rows[0] ?? null;
}

/**
 * One user holds ONE calendar connection, whatever its provider.
 *
 * `uq_calendar_connections_user_provider` would physically permit a Google row
 * and an Apple row side by side, but nothing in the write path could then
 * decide which calendar an inspection belongs on, and `calendar_external_links`
 * is keyed per provider — so a second connection would silently orphan the
 * first one's links. The connect endpoints refuse a second provider for a user
 * who already holds one, and say so.
 */
export async function loadOpenCalendarConnection(
    db: D1Database,
    tenantId: string,
    userId: string,
    jwtSecret: string,
    jwtSecretPrevious?: string,
    provider?: CalendarProviderId,
): Promise<OpenCalendarConnection | null> {
    const connection = await getCalendarConnection(db, tenantId, userId, provider);
    if (!connection) return null;
    // A connection whose credentials no longer decrypt (e.g. a key rotation, or
    // corrupted/placeholder secrets) is unusable — treat it as not-open rather
    // than throwing, so callers degrade to "not connected" instead of a 500.
    let credentials: CalendarCredentialPayload;
    try {
        credentials = await openCredentials(
            connection.credentialsEnc,
            connection.credentialsDekEnc,
            tenantId,
            jwtSecret,
            jwtSecretPrevious,
        );
    } catch (e) {
        logger.warn('[calendar] connection credentials failed to decrypt', {
            tenantId, userId, error: e instanceof Error ? e.message : String(e),
        });
        return null;
    }
    // Whether the payload is USABLE is the provider's judgement, not this
    // module's: an empty refresh token is a Google fact, and asserting it here
    // would reject every valid CalDAV payload. `resolveAuth` returns null.
    return { connection, credentials };
}

export async function upsertCalendarConnection(input: {
    db: D1Database;
    tenantId: string;
    userId: string;
    provider: CalendarProviderId;
    authType: 'oauth' | 'caldav';
    capability: CalendarCapability;
    calendarId: string;
    credentials: CalendarCredentialPayload;
    jwtSecret: string;
    jwtSecretPrevious?: string;
    existingDekEnc?: string | null;
}): Promise<CalendarConnectionRow> {
    const drizzleDb = drizzle(input.db);
    const sealed: SealedCalendarCredentials = await sealCredentials(
        input.credentials,
        input.tenantId,
        input.jwtSecret,
        input.existingDekEnc,
        input.jwtSecretPrevious,
    );
    const now = new Date();
    const id = crypto.randomUUID();
    const values = {
        id,
        tenantId: input.tenantId,
        userId: input.userId,
        provider: input.provider,
        authType: input.authType,
        credentialsEnc: sealed.credentialsEnc,
        credentialsDekEnc: sealed.credentialsDekEnc,
        capabilities: input.capability,
        calendarId: input.calendarId,
        connectedAt: now,
        updatedAt: now,
    };
    await drizzleDb.insert(calendarConnections).values(values).onConflictDoUpdate({
        target: [calendarConnections.userId, calendarConnections.provider],
        set: {
            credentialsEnc: values.credentialsEnc,
            credentialsDekEnc: values.credentialsDekEnc,
            capabilities: values.capabilities,
            calendarId: values.calendarId,
            updatedAt: now,
        },
    });
    const row = await getCalendarConnection(input.db, input.tenantId, input.userId, input.provider);
    if (!row) throw new Error('Failed to persist calendar connection');
    return row;
}

/**
 * Records a completed busy pull. Distinct from updatedAt, which tracks writes
 * to the connection itself: re-authenticating is not a sync. Only call this
 * once the provider fetch has actually succeeded — the freshness badge vouches
 * for data we hold.
 */
export async function markCalendarSynced(
    db: D1Database,
    tenantId: string,
    userId: string,
    provider?: CalendarProviderId,
): Promise<void> {
    const drizzleDb = drizzle(db);
    // Clearing lastSyncError is half the job. Left behind, a fixed connection
    // would keep showing the reconnect prompt for the failure it recovered from.
    await drizzleDb.update(calendarConnections)
        .set({ lastSyncAt: new Date(), lastSyncError: null })
        .where(and(
            eq(calendarConnections.tenantId, tenantId),
            eq(calendarConnections.userId, userId),
            ...(provider ? [eq(calendarConnections.provider, provider)] : []),
        ));
}

/**
 * Records why the latest sync attempt failed. Deliberately does NOT touch
 * lastSyncAt: that column vouches for the freshness of data we actually hold,
 * and a failed attempt did not refresh anything. The badge stays stale AND
 * gains a reason, which is the honest pair.
 */
export async function markCalendarSyncFailed(
    db: D1Database,
    tenantId: string,
    userId: string,
    message: string,
    provider?: CalendarProviderId,
): Promise<void> {
    const drizzleDb = drizzle(db);
    await drizzleDb.update(calendarConnections)
        .set({ lastSyncError: message.slice(0, 500) })
        .where(and(
            eq(calendarConnections.tenantId, tenantId),
            eq(calendarConnections.userId, userId),
            ...(provider ? [eq(calendarConnections.provider, provider)] : []),
        ));
}

export async function deleteCalendarConnection(
    db: D1Database,
    tenantId: string,
    userId: string,
    provider?: CalendarProviderId,
): Promise<void> {
    const drizzleDb = drizzle(db);
    await drizzleDb.delete(calendarConnections).where(and(
        eq(calendarConnections.tenantId, tenantId),
        eq(calendarConnections.userId, userId),
        ...(provider ? [eq(calendarConnections.provider, provider)] : []),
    ));
}

export async function userHasCalendarConnection(
    db: D1Database,
    tenantId: string,
    userId: string,
    provider?: CalendarProviderId,
): Promise<boolean> {
    return (await getCalendarConnection(db, tenantId, userId, provider)) !== null;
}
