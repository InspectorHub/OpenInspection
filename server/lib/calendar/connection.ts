import { drizzle } from 'drizzle-orm/d1';
import { and, eq } from 'drizzle-orm';
import { logger } from '../logger';
import { calendarConnections } from '../db/schema/calendar';
import type { CalendarCapability, CalendarProviderId } from './provider';
import {
    openCredentials,
    sealCredentials,
    type CalendarOAuthCredentials,
    type SealedCalendarCredentials,
} from './credentials';

export type CalendarConnectionRow = typeof calendarConnections.$inferSelect;

export interface OpenCalendarConnection {
    connection: CalendarConnectionRow;
    credentials: CalendarOAuthCredentials;
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

export async function getCalendarConnection(
    db: D1Database,
    tenantId: string,
    userId: string,
    provider: CalendarProviderId = 'google',
): Promise<CalendarConnectionRow | null> {
    const drizzleDb = drizzle(db);
    const rows = await drizzleDb
        .select()
        .from(calendarConnections)
        .where(and(
            eq(calendarConnections.tenantId, tenantId),
            eq(calendarConnections.userId, userId),
            eq(calendarConnections.provider, provider),
        ))
        .limit(1);
    return rows[0] ?? null;
}

export async function loadOpenGoogleConnection(
    db: D1Database,
    tenantId: string,
    userId: string,
    jwtSecret: string,
    jwtSecretPrevious?: string,
): Promise<OpenCalendarConnection | null> {
    const connection = await getCalendarConnection(db, tenantId, userId, 'google');
    if (!connection) return null;
    // A connection whose credentials no longer decrypt (e.g. a key rotation, or
    // corrupted/placeholder secrets) is unusable — treat it as not-open rather
    // than throwing, so callers degrade to "not connected" instead of a 500.
    let credentials: CalendarOAuthCredentials;
    try {
        credentials = await openCredentials(
            connection.credentialsEnc,
            connection.credentialsDekEnc,
            tenantId,
            jwtSecret,
            jwtSecretPrevious,
        ) as CalendarOAuthCredentials;
    } catch (e) {
        logger.warn('[calendar] connection credentials failed to decrypt', {
            tenantId, userId, error: e instanceof Error ? e.message : String(e),
        });
        return null;
    }
    if (!credentials.refreshToken) return null;
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
    credentials: CalendarOAuthCredentials;
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
    provider: CalendarProviderId = 'google',
): Promise<void> {
    const drizzleDb = drizzle(db);
    await drizzleDb.update(calendarConnections)
        .set({ lastSyncAt: new Date() })
        .where(and(
            eq(calendarConnections.tenantId, tenantId),
            eq(calendarConnections.userId, userId),
            eq(calendarConnections.provider, provider),
        ));
}

export async function deleteCalendarConnection(
    db: D1Database,
    tenantId: string,
    userId: string,
    provider: CalendarProviderId = 'google',
): Promise<void> {
    const drizzleDb = drizzle(db);
    await drizzleDb.delete(calendarConnections).where(and(
        eq(calendarConnections.tenantId, tenantId),
        eq(calendarConnections.userId, userId),
        eq(calendarConnections.provider, provider),
    ));
}

export async function userHasCalendarConnection(
    db: D1Database,
    tenantId: string,
    userId: string,
    provider: CalendarProviderId = 'google',
): Promise<boolean> {
    return (await getCalendarConnection(db, tenantId, userId, provider)) !== null;
}
