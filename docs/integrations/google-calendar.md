# Google Calendar

Keeps an inspector's own Google Calendar and their OpenInspection schedule in
step, in both directions: busy times from Google feed availability, and
inspections pushed to Google appear as events.

This is a **per-inspector** connection, not a company-wide one. Each person
authorises their own calendar; nobody's calendar is readable by the company
because the company connected something.

## What you need

Settings → Communication → Calendar holds the deployment's OAuth client:

| Key | Notes |
|---|---|
| `GOOGLE_CLIENT_ID` | From a Google Cloud project with the Calendar API enabled |
| `GOOGLE_CLIENT_SECRET` | Same project |

Add your deployment's callback as an authorised redirect URI in that Google
project. Individual inspectors then connect from their own profile — they never
see or need these keys.

## Two capabilities, two scope sets

A connection stores which capability was granted, derived from the scopes Google
actually returned at callback (`capabilityFromScopes`), not from what was asked
for:

| Capability | What it enables |
|---|---|
| `availability_read` | Busy blocks feed scheduling. Read-only |
| `events_read_write` | The above, plus inspections written back as calendar events |

Storing what was granted rather than what was requested matters: a user can
approve a narrower scope than the consent screen offered, and a connection that
recorded the request would then claim a capability it does not have.

## Pushes are detached, and never fail your save

`server/lib/calendar/push-hooks.ts` runs all three write paths **detached**: the
response is already sent by the time Google is contacted, and nothing there is
allowed to reject. A slow or broken calendar cannot make saving an inspection
feel slow or fail.

The trade is stated rather than hidden: a push that fails is logged, not
surfaced as an error on the save that triggered it. If an event is missing from
someone's calendar, the sync status on their profile is the place to look.

## When it is not configured

The Calendar section shows nothing to connect, and inspectors schedule entirely
inside OpenInspection. Availability then comes from the app's own calendar and
working hours, which is a complete answer — just not one that knows about the
dentist appointment in someone's personal calendar.

## Where the code lives

- `server/lib/calendar/google.ts` — the provider, scopes, capability derivation
- `server/lib/calendar/google-import.ts` / `google-export.ts` — the two directions
- `server/lib/calendar/push-hooks.ts` — the detached write seam
- `server/lib/calendar/registry.ts` — provider lookup by id
- `server/lib/calendar/sync-engine.ts`, `sync-sweep.ts` — reconciliation

`CalendarProviderId` also declares `'microsoft'`. There is no implementation:
the registry holds `google` and `apple` only, and `getCalendarProvider` throws
for anything else. The type is ahead of the code, deliberately and visibly.

## Related

- [Apple Calendar (CalDAV)](apple-calendar.md) — the other provider
- [Integration adapters](../develop/integration-adapters.md)
