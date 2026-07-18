export type CalendarProviderId = 'google' | 'microsoft' | 'apple';
type CalendarAuthType = 'oauth' | 'caldav';
export type CalendarCapability = 'availability_read' | 'events_read_write';

export interface BusyBlock {
    start: string;
    end: string;
    // A-polish 10 — provider event id (for keyed upsert) and free/busy status.
    // freeBusy ranges carry neither; the sync helper synthesizes an id and
    // defaults transparency to 'opaque'.
    externalId?: string;
    transparency?: 'opaque' | 'transparent';
}

/** A-polish 10b — one calendar from the provider's calendar list. */
export interface CalendarListEntry {
    id: string;
    summary: string;
    accessRole: string; // owner | writer | reader | freeBusyReader
    primary: boolean;
}

interface CalendarPushEventInput {
    summary: string;
    location?: string;
    description?: string;
    start: Date;
    end: Date;
}

export interface PkceChallenge {
    verifier: string;
    challenge: string;
}

export interface OAuthExchangeResult {
    credentials: {
        refreshToken: string;
        accessToken?: string;
        expiresAt?: string;
    };
    scopes: string[];
    calendarId: string;
}

/** Normalized calendar provider contract (Google impl now; Microsoft/Apple later). */
export interface CalendarProvider {
    id: CalendarProviderId;
    authType: CalendarAuthType;
    getAuthUrl(params: {
        clientId: string;
        redirectUri: string;
        state: string;
        pkce: PkceChallenge;
        capability: CalendarCapability;
    }): URL;
    exchangeCode(params: {
        clientId: string;
        clientSecret: string;
        redirectUri: string;
        code: string;
        verifier: string;
    }): Promise<OAuthExchangeResult>;
    listBusy(params: {
        clientId: string;
        clientSecret: string;
        refreshToken: string;
        calendarId: string;
        range: { from: Date; to: Date };
        capability: CalendarCapability;
    }): Promise<BusyBlock[]>;
    // A-polish 10b — the user's calendars, for choosing the multi-read set and
    // the single write target.
    listCalendars(params: {
        clientId: string;
        clientSecret: string;
        refreshToken: string;
    }): Promise<CalendarListEntry[]>;
    pushEvent(params: {
        clientId: string;
        clientSecret: string;
        refreshToken: string;
        calendarId: string;
        event: CalendarPushEventInput;
    }): Promise<string>;
    deleteEvent(params: {
        clientId: string;
        clientSecret: string;
        refreshToken: string;
        calendarId: string;
        externalId: string;
    }): Promise<void>;
}

const GOOGLE_SCOPES: Record<CalendarCapability, string[]> = {
    availability_read: [
        'https://www.googleapis.com/auth/calendar.freebusy',
        'https://www.googleapis.com/auth/calendar.readonly',
    ],
    events_read_write: [
        'https://www.googleapis.com/auth/calendar.events',
    ],
};

export function capabilityToScopes(provider: CalendarProviderId, capability: CalendarCapability): string[] {
    if (provider === 'google') return GOOGLE_SCOPES[capability];
    throw new Error(`Unsupported calendar provider: ${provider}`);
}

/** Derive stored capability from OAuth scopes granted at callback. */
export function capabilityFromScopes(scopes: string[]): CalendarCapability {
    const normalized = scopes.map((s) => s.toLowerCase());
    if (normalized.some((s) => s.includes('calendar.events'))) {
        return 'events_read_write';
    }
    return 'availability_read';
}

export function canPushEvents(capability: CalendarCapability): boolean {
    return capability === 'events_read_write';
}

/** Web Crypto PKCE S256 challenge for OAuth connect. */
export async function createPkceChallenge(): Promise<PkceChallenge> {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const verifier = btoa(String.fromCharCode(...bytes))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    return { verifier, challenge };
}
