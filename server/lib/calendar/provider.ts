import type { CalendarCredentialPayload } from './credentials';

export type CalendarProviderId = 'google' | 'microsoft' | 'apple';
export type CalendarAuthType = 'oauth' | 'caldav';
export type CalendarCapability = 'availability_read' | 'events_read_write';

export interface BusyBlock {
    start: string;
    end: string;
    // A-polish 10 — provider event id (for keyed upsert) and free/busy status.
    // freeBusy ranges carry neither; the sync helper synthesizes an id and
    // defaults transparency to 'opaque'.
    externalId?: string;
    transparency?: 'opaque' | 'transparent';
    /**
     * Set when this block is one instance of a recurring series. Only the
     * events path can know this; freeBusy ranges never carry it.
     */
    recurringEventId?: string;
    /** Epoch ms the provider created the event, when it reports one. */
    createdMs?: number;
    /** Epoch ms the provider last modified the event, when it reports one. */
    updatedMs?: number;
}

/** A-polish 10b — one calendar from the provider's calendar list. */
export interface CalendarListEntry {
    id: string;
    summary: string;
    accessRole: string; // owner | writer | reader | freeBusyReader
    primary: boolean;
}

export interface CalendarPushEventInput {
    summary: string;
    location?: string;
    description?: string;
    start: Date;
    end: Date;
    /**
     * IANA zone the event belongs to (the tenant's). The instants above already
     * pin the moment; this pins the zone the provider renders and recurs in, so
     * an event does not drift an hour when the tenant crosses a DST boundary.
     * Omitted only by callers that genuinely have no tenant zone.
     */
    timeZone?: string;
}

export interface PkceChallenge {
    verifier: string;
    challenge: string;
}

/** How a provider's connect is driven. The UI branches on `kind`. */
export type CalendarConnectFlow =
    | { kind: 'redirect' }   // OAuth: navigate a popup, land on oauth-popup-landing
    | { kind: 'form' };      // CalDAV: collect fields in-page, never open a popup

/** OAuth: the code and the verifier. CalDAV: what the user typed. */
export type CalendarConnectSubmission =
    | { kind: 'oauth_code'; code: string; verifier: string; redirectUri: string }
    | { kind: 'credentials'; username: string; password: string; url?: string };

export interface CalendarConnectResult {
    credentials: CalendarCredentialPayload;   // the CALLER seals it
    calendarId: string;
    authType: CalendarAuthType;
    /**
     * The capability to record on the row.
     *
     * For an OAuth provider this is DERIVED: it is what the provider actually
     * granted, read back off the scopes on the token response. The provider
     * enforces it — a read-only grant cannot write even if we tried.
     *
     * For CalDAV it is DECLARED: an app-specific password is all-or-nothing
     * and the server reports no scopes at all, so this is the capability the
     * USER selected and it is a promise WE keep. Nothing on the far side
     * stops a bug here from writing to a calendar the user marked read-only.
     *
     * Same column, two different guarantees. A reader who does not know that
     * will treat it as uniform, which is why it is written down here.
     */
    capability: CalendarCapability;
}

/**
 * A connect failure the USER can act on — a rejected credential, a grant that
 * came back without what we need, an address with no calendar home behind it.
 *
 * Its `message` is shown to the user verbatim, so it must never carry
 * credential material: no app password, no refresh token, no Basic header.
 * Anything else that goes wrong is a plain Error and gets a generic message.
 */
export class CalendarConnectError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'CalendarConnectError';
    }
}

/**
 * The bindings any provider may need to authenticate. Same shape the Google
 * OAuth resolver already takes; named here so callers stop assembling it
 * per-file.
 */
export interface CalendarProviderEnv {
    DB: D1Database;
    TENANT_CACHE: KVNamespace;
    JWT_SECRET: string;
    JWT_SECRET_PREVIOUS?: string;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
}

/**
 * A provider-minted authentication handle.
 *
 * Deliberately opaque. Callers move it from `resolveAuth` to a data-plane
 * method and never read a field off it, because what is inside differs by
 * auth type: an OAuth client plus a refresh token for Google, an Apple ID
 * plus an app-specific password plus a discovered home URL for CalDAV.
 * Making it readable is precisely how `clientId` came to appear in ten files
 * that have no business knowing OAuth exists.
 */
export interface CalendarAuth<TMaterial = unknown> {
    readonly provider: CalendarProviderId;
    /** Provider-private. Only the provider that minted this may read it. */
    readonly material: TMaterial;
}

export interface CalendarAuthInput {
    tenantId: string;
    /** The decrypted payload from `openCredentials` — union, NOT cast. */
    credentials: CalendarCredentialPayload;
    env: CalendarProviderEnv;
}

/** Normalized calendar provider contract (Google impl now; Microsoft/Apple later). */
export interface CalendarProvider {
    id: CalendarProviderId;
    authType: CalendarAuthType;
    /**
     * Mint the handle every data-plane method takes, or null when this
     * connection cannot be authenticated at all — a Google connection on a
     * deployment with no OAuth client, or a stored payload of the wrong
     * shape. Null is the caller's OAUTH_NOT_CONFIGURED / NOT_CONNECTED; it
     * is not an error to log.
     */
    resolveAuth(input: CalendarAuthInput): Promise<CalendarAuth | null>;
    connectFlow: CalendarConnectFlow;
    /** Only meaningful for `kind: 'redirect'`. Absent on form providers. */
    startConnect?(params: {
        clientId?: string;
        redirectUri: string;
        state: string;
        pkce: PkceChallenge;
        capability: CalendarCapability;
    }): URL;
    completeConnect(params: {
        tenantId: string;
        env: CalendarProviderEnv;
        submission: CalendarConnectSubmission;
        /** What the user asked for at connect; the floor for a declared capability. */
        requestedCapability: CalendarCapability;
    }): Promise<CalendarConnectResult>;
    listBusy(params: {
        auth: CalendarAuth;
        calendarId: string;
        range: { from: Date; to: Date };
        capability: CalendarCapability;
    }): Promise<BusyBlock[]>;
    // A-polish 10b — the user's calendars, for choosing the multi-read set and
    // the single write target.
    listCalendars(params: { auth: CalendarAuth }): Promise<CalendarListEntry[]>;
    pushEvent(params: {
        auth: CalendarAuth;
        calendarId: string;
        event: CalendarPushEventInput;
    }): Promise<string>;
    /**
     * Updates an event this deployment previously created. Separate from
     * pushEvent because a reschedule must MOVE the entry the inspector already
     * has on their phone — creating a second one and deleting the first loses
     * their notification state and any guest responses.
     */
    patchEvent(params: {
        auth: CalendarAuth;
        calendarId: string;
        externalId: string;
        event: CalendarPushEventInput;
    }): Promise<void>;
    deleteEvent(params: {
        auth: CalendarAuth;
        calendarId: string;
        externalId: string;
    }): Promise<void>;
}

/** Thrown when the provider says the remote event is gone (404/410). */
export class ExternalEventGoneError extends Error {
    constructor(externalId: string) {
        super(`External calendar event no longer exists: ${externalId}`);
        this.name = 'ExternalEventGoneError';
    }
}

// Scope mapping used to live here behind a `provider` parameter that threw for
// everything but google. That was a Google fact wearing a generic signature —
// CalDAV has no concept of a scope at all — so it now lives in `google.ts` as
// `googleCapabilityScopes` / `capabilityFromScopes`.

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
