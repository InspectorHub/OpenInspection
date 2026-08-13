import { sealSecrets, openSecrets } from '../config-crypto';

/** OAuth refresh/access tokens + granted scopes (Google / Microsoft). */
interface CalendarOAuthCredentials {
    refreshToken: string;
    accessToken?: string;
    expiresAt?: string;
    scopes: string[];
}

/**
 * CalDAV app-password shape (Apple / iCloud).
 *
 * `username` is the Apple ID the app-specific password belongs to: iCloud
 * authenticates on it, and it is not derivable from `url`, which names the
 * discovered calendar home and already has one meaning.
 */
interface CalendarCalDavCredentials {
    username: string;
    appPassword: string;
    url: string;
}

export type CalendarCredentialPayload = CalendarOAuthCredentials | CalendarCalDavCredentials;

const SCOPES_KEY = 'scopes';

function toSealRecord(payload: CalendarCredentialPayload): Record<string, string> {
    if ('appPassword' in payload) {
        return { username: payload.username ?? '', appPassword: payload.appPassword, url: payload.url };
    }
    const record: Record<string, string> = { refreshToken: payload.refreshToken };
    if (payload.accessToken) record.accessToken = payload.accessToken;
    if (payload.expiresAt) record.expiresAt = payload.expiresAt;
    record[SCOPES_KEY] = JSON.stringify(payload.scopes);
    return record;
}

function fromSealRecord(record: Record<string, string>): CalendarCredentialPayload {
    // The discriminator stays `appPassword && url` on purpose. Keying it on
    // `username` would make a row sealed before that field existed decode as an
    // OAuth payload with an empty refresh token — unusable, and silent.
    if (record.appPassword && record.url) {
        return { username: record.username ?? '', appPassword: record.appPassword, url: record.url };
    }
    const scopesRaw = record[SCOPES_KEY];
    const scopes: string[] = scopesRaw ? JSON.parse(scopesRaw) as string[] : [];
    return {
        refreshToken: record.refreshToken ?? '',
        accessToken: record.accessToken,
        expiresAt: record.expiresAt,
        scopes,
    };
}

export interface SealedCalendarCredentials {
    credentialsEnc: string;
    credentialsDekEnc: string;
}

/** Encrypt calendar credentials at rest (tenant-bound envelope). */
export async function sealCredentials(
    payload: CalendarCredentialPayload,
    tenantId: string,
    jwtSecret: string,
    existingDekEnc?: string | null,
    previousJwtSecret?: string,
): Promise<SealedCalendarCredentials> {
    const sealed = await sealSecrets(
        toSealRecord(payload),
        tenantId,
        jwtSecret,
        existingDekEnc,
        previousJwtSecret,
    );
    return { credentialsEnc: sealed.blob, credentialsDekEnc: sealed.dekEnc };
}

/** Decrypt calendar credentials from the paired envelope columns. */
export async function openCredentials(
    credentialsEnc: string,
    credentialsDekEnc: string,
    tenantId: string,
    jwtSecret: string,
    previousJwtSecret?: string,
): Promise<CalendarCredentialPayload> {
    const record = await openSecrets(
        credentialsEnc,
        credentialsDekEnc,
        tenantId,
        jwtSecret,
        previousJwtSecret,
    );
    return fromSealRecord(record);
}
