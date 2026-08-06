/**
 * Google Calendar OAuth plumbing — endpoints, token refresh, and the event
 * shape the provider layer parses.
 *
 * The event WRITES used to live here too (`createCalendarEvent`,
 * `syncEventsToGcal`). Both are gone. They pushed without an assignment
 * boundary — every tenant event went to whichever user pressed the button —
 * had no update or delete, so a reschedule or a cancellation never reached the
 * calendar, and guessed a 30-minute duration. Writes now go through
 * `lib/calendar/google-export.ts`, which resolves the lead through the roster
 * and tracks each event id in `calendar_external_links`.
 */

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

export function getRedirectUri(baseUrl: string) {
    return `${baseUrl}/api/calendar/callback`;
}

export interface GoogleTokenResponse {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    token_type: string;
    error_description?: string;
    error?: string;
}

export interface GoogleCalendarResponse {
    id: string;
    [key: string]: unknown;
}

export interface GoogleEvent {
    id: string;
    summary?: string;
    start?: { date?: string; dateTime?: string };
    end?: { date?: string; dateTime?: string };
    // 'transparent' = the event shows the owner as free (does not block).
    transparency?: string;
    /**
     * Present on every INSTANCE of a recurring series (singleEvents=true
     * expands series into instances), naming the series it came from. Its
     * presence is how the import tells a one-off appointment from a weekly
     * standup — Spectora imports only the former.
     */
    recurringEventId?: string;
    /** RFC-3339 creation time; drives the do-not-backfill-before-connect rule. */
    created?: string;
    /** RFC-3339 last-modified time; an old event edited after connect counts as new. */
    updated?: string;
}

export async function refreshAccessToken(clientId: string, clientSecret: string, refreshToken: string): Promise<string> {
    const res = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: clientId,
            client_secret: clientSecret,
        }),
    });
    const data = await res.json() as GoogleTokenResponse;
    if (!res.ok) throw new Error(`Token refresh failed: ${data.error_description ?? data.error}`);
    return data.access_token;
}
