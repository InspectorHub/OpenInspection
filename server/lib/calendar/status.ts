import { getCalendarConnection } from './connection';
import { isGoogleOAuthConfigured } from './resolve-google-oauth';
import type { HonoConfig } from '../../types/hono';

export async function getGoogleCalendarStatus(
    env: HonoConfig['Bindings'],
    tenantId: string,
    userId: string,
) {
    const connection = await getCalendarConnection(env.DB, tenantId, userId);
    return {
        connected: Boolean(connection),
        capability: connection?.capabilities ?? null,
        provider: connection?.provider ?? null,
        // Reads generic, means one specific thing: whether GOOGLE OAuth is
        // configured on this deployment. It gates the Google button and only
        // the Google button — CalDAV needs no OAuth client at all.
        oauthConfigured: await isGoogleOAuthConfigured(env, tenantId),
        lastSyncAt: connection?.lastSyncAt instanceof Date ? connection.lastSyncAt.getTime() : null,
        // NULL once a sync succeeds. Surfaced because a stale freshness badge
        // cannot say whether nothing changed or nobody could reach Google —
        // and a revoked token is only fixable by the person who sees this.
        lastSyncError: connection?.lastSyncError ?? null,
    };
}
