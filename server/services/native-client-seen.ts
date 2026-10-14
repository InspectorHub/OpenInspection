/**
 * Recording which native app versions a company's devices run.
 *
 * The product rule (nothing is turned away while it still holds captured work)
 * means an old version can only be retired once it has stopped appearing. This is
 * the record that says when it last did. See `nativeClientSeen` for the table.
 *
 * Every write is bounded: one write per (version, hour), at most
 * `NATIVE_SEEN_MAX_ROWS_PER_TENANT` versions per company, and a version string is
 * accepted only in the dotted-number form `normalizeClientVersion` understands.
 * A failure is logged and never reaches the caller, because the app's session
 * call must not fail over bookkeeping.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { nativeClientSeen } from '../lib/db/schema';
import { logger } from '../lib/logger';
import { isClientPlatform, normalizeClientVersion } from '../lib/native/client-version';

/** A row is rewritten at most this often. */
export const NATIVE_SEEN_REFRESH_MS = 60 * 60 * 1000;
/** Most distinct (platform, version) rows one company may hold. */
export const NATIVE_SEEN_MAX_ROWS_PER_TENANT = 200;

export async function recordNativeClientSeen(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: DrizzleD1Database<any>,
    tenantId: string,
    platformHeader: string | undefined,
    versionHeader: string | undefined,
    now: Date = new Date(),
): Promise<void> {
    if (!isClientPlatform(platformHeader)) return;
    const clientVersion = normalizeClientVersion(versionHeader);
    if (!clientVersion) return;
    try {
        const key = and(
            eq(nativeClientSeen.tenantId, tenantId),
            eq(nativeClientSeen.platform, platformHeader),
            eq(nativeClientSeen.clientVersion, clientVersion),
        );
        const existing = await db.select({ lastSeenAt: nativeClientSeen.lastSeenAt })
            .from(nativeClientSeen).where(key).get();
        if (existing) {
            if (now.getTime() - existing.lastSeenAt.getTime() < NATIVE_SEEN_REFRESH_MS) return;
            await db.update(nativeClientSeen).set({ lastSeenAt: now }).where(key);
            return;
        }
        const held = await db.select({ n: sql<number>`count(*)` }).from(nativeClientSeen)
            .where(eq(nativeClientSeen.tenantId, tenantId)).get();
        if ((held?.n ?? 0) >= NATIVE_SEEN_MAX_ROWS_PER_TENANT) return;
        await db.insert(nativeClientSeen)
            .values({ tenantId, platform: platformHeader, clientVersion, firstSeenAt: now, lastSeenAt: now })
            .onConflictDoUpdate({
                target: [nativeClientSeen.tenantId, nativeClientSeen.platform, nativeClientSeen.clientVersion],
                set: { lastSeenAt: now },
            });
    } catch (err) {
        logger.warn('Failed to record the native client version seen', {
            tenantId,
            error: err instanceof Error ? err.message : String(err),
        });
    }
}
