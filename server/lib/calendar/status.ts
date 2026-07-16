import { getCalendarConnection } from './connection';
import { isGoogleOAuthConfigured } from './resolve-google-oauth';
import type { HonoConfig } from '../../types/hono';

export async function getGoogleCalendarStatus(
    env: HonoConfig['Bindings'],
    tenantId: string,
    userId: string,
) {
    const connection = await getCalendarConnection(env.DB, tenantId, userId, 'google');
    return {
        connected: Boolean(connection),
        capability: connection?.capabilities ?? null,
        provider: 'google' as const,
        oauthConfigured: await isGoogleOAuthConfigured(env, tenantId),
    };
}
