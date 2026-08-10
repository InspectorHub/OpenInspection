/**
 * The `CalendarProvider` implementation for Apple / iCloud, over CalDAV.
 *
 * It holds an Apple ID plus an app-specific password plus a discovered calendar
 * home. None of that leaves this module: callers move an opaque `CalendarAuth`
 * from `resolveAuth` to a data-plane method and never read a field off it.
 */
import { CalendarConnectError } from '../provider';
import type {
    CalendarAuth,
    CalendarAuthInput,
    CalendarConnectResult,
    CalendarProvider,
    BusyBlock,
    CalendarListEntry,
} from '../provider';
import { discoverCalendarHome, ICLOUD_CALDAV_BASE } from './discovery';
import { davFetch, resolveHref } from './client';
import {
    PROPFIND_CALENDARS,
    buildCalendarQuery,
    parseMultistatus,
    hasElement,
} from './xml';
import { parseVEvents } from './ical';

const DAV_CONTENT_TYPE = 'application/xml; charset=utf-8';

/**
 * What rides inside an Apple `CalendarAuth`. Module-private: the whole point of
 * the handle is that nothing outside here can reach the app password.
 */
interface AppleAuthMaterial {
    username: string;
    password: string;
    homeUrl: string;
}

/**
 * Unwrap a handle this provider minted. A handle stamped with someone else's
 * provider id is a routing bug, and it must be loud rather than silently
 * half-working against credentials that mean nothing here.
 */
function appleMaterialOf(auth: CalendarAuth): AppleAuthMaterial {
    if (auth.provider !== 'apple') {
        throw new Error(`Calendar auth handle for '${auth.provider}' handed to the apple provider`);
    }
    return auth.material as AppleAuthMaterial;
}

export const appleCalendarProvider: CalendarProvider = {
    id: 'apple',
    authType: 'caldav',
    connectFlow: { kind: 'form' },
    // No startConnect: there is no consent screen to navigate to, and opening a
    // popup for a form would be the §4.2 guarantee broken.

    async resolveAuth({ credentials }: CalendarAuthInput): Promise<CalendarAuth | null> {
        if (!('appPassword' in credentials)) return null;
        const { username, appPassword, url } = credentials;
        // All three are required. A row missing any of them predates this
        // provider or was written wrong; null is "not connected", not a throw.
        if (!username || !appPassword || !url) return null;
        return {
            provider: 'apple',
            material: { username, password: appPassword, homeUrl: url } satisfies AppleAuthMaterial,
        };
    },

    async completeConnect({ submission, requestedCapability }): Promise<CalendarConnectResult> {
        if (submission.kind !== 'credentials') {
            throw new CalendarConnectError('Apple Calendar connects with an Apple ID and an app-specific password');
        }
        const auth = { username: submission.username, password: submission.password };
        const { homeUrl } = await discoverCalendarHome({
            baseUrl: submission.url || ICLOUD_CALDAV_BASE,
            auth,
        });
        // The write target is the calendar `listCalendars` marks primary — our
        // choice standing in for a concept CalDAV does not have. The home
        // itself is the fallback when the account exposes no writable calendar,
        // so a connection is still recorded and the read path still works.
        const handle: CalendarAuth = {
            provider: 'apple',
            material: { username: auth.username, password: auth.password, homeUrl } satisfies AppleAuthMaterial,
        };
        const calendars = await appleCalendarProvider.listCalendars({ auth: handle });
        const primary = calendars.find((c) => c.primary);

        return {
            credentials: { username: submission.username, appPassword: submission.password, url: homeUrl },
            calendarId: primary?.id ?? homeUrl,
            authType: 'caldav',
            // DECLARED, not derived. An app-specific password is all-or-nothing
            // and the server reports no scopes, so this is a promise WE keep —
            // see the note on CalendarConnectResult.capability.
            capability: requestedCapability,
        };
    },

    async listCalendars({ auth }): Promise<CalendarListEntry[]> {
        const { username, password, homeUrl } = appleMaterialOf(auth);
        const res = await davFetch('PROPFIND', homeUrl, {
            auth: { username, password },
            depth: '1',
            body: PROPFIND_CALENDARS,
            contentType: DAV_CONTENT_TYPE,
        });
        if (!res.ok && res.status !== 207) {
            throw new Error('Failed to fetch CalDAV calendar list');
        }

        const entries = parseMultistatus(await res.text())
            // A calendar collection, and one that actually holds events: a
            // Reminders list and a scheduling inbox are both collections here.
            .filter((row) => hasElement(row.props.resourcetype, 'calendar'))
            .filter((row) => hasElement(row.props['supported-calendar-component-set'], 'comp')
                ? /name="VEVENT"/i.test(row.props['supported-calendar-component-set'] ?? '')
                : false)
            .map((row) => ({
                id: row.href,
                summary: row.props.displayname || row.href,
                accessRole: hasElement(row.props['current-user-privilege-set'], 'write-content')
                    ? 'writer'
                    : 'reader',
                primary: false,
            }))
            .sort((a, b) => a.id.localeCompare(b.id));

        // ⚠️ CalDAV has no "primary" calendar, and `resolveReadSet` requires
        // one: it validates the write target and unconditionally adds the
        // primary to the effective read set. So WE choose — the first writable
        // VEVENT collection by sorted href. The server did not tell us this.
        const primary = entries.find((entry) => entry.accessRole === 'writer');
        if (primary) primary.primary = true;
        return entries;
    },

    async listBusy({ auth, calendarId, range }): Promise<BusyBlock[]> {
        const { username, password, homeUrl } = appleMaterialOf(auth);
        // `capability` deliberately changes nothing here. There is no free-busy
        // path to fall back to, so a read-only connection reads events the same
        // way a read-write one does; the capability gates WRITES elsewhere.
        //
        // `free-busy-query` would be the optimisation. It is NOT implemented:
        // server support for it varies and we have not verified that Apple
        // honours it. Verify that first, then add it.
        const collectionUrl = resolveHref(homeUrl, calendarId);
        const res = await davFetch('REPORT', collectionUrl, {
            auth: { username, password },
            depth: '1',
            body: buildCalendarQuery(range),
            contentType: DAV_CONTENT_TYPE,
        });
        if (!res.ok && res.status !== 207) {
            throw new Error('Failed to fetch CalDAV events');
        }

        const blocks: BusyBlock[] = [];
        for (const row of parseMultistatus(await res.text())) {
            const calendarData = row.props['calendar-data'];
            if (!calendarData) continue;
            for (const event of parseVEvents(calendarData)) {
                blocks.push({
                    start: new Date(event.startMs).toISOString(),
                    end: new Date(event.endMs).toISOString(),
                    // ⚠️ The RESOURCE HREF, not the UID. The href is what a
                    // write must address AND what `listOwnExternalIds` compares
                    // against — one identifier used by both sides is the only
                    // way the skip-events-OI-pushed-itself rule can work.
                    externalId: row.href,
                    transparency: event.transparent ? 'transparent' : 'opaque',
                    // Either marks this as part of a series, which is what the
                    // existing recurring-instance import rule keys on.
                    ...(event.recurrenceId || event.rrule
                        ? { recurringEventId: event.recurrenceId ?? event.rrule! }
                        : {}),
                    ...(event.createdMs != null ? { createdMs: event.createdMs } : {}),
                    ...(event.lastModifiedMs != null ? { updatedMs: event.lastModifiedMs } : {}),
                });
            }
        }
        return blocks;
    },

    async pushEvent(): Promise<string> {
        throw new Error('not implemented');
    },

    async patchEvent(): Promise<void> {
        throw new Error('not implemented');
    },

    async deleteEvent(): Promise<void> {
        throw new Error('not implemented');
    },
};
