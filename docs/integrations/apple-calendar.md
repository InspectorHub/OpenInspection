# Apple Calendar (CalDAV)

The same two-way schedule sync as Google, over CalDAV, for iCloud calendars.

## What you need

**Nothing at the deployment level.** There is no OAuth client to register and no
env key: CalDAV authenticates with credentials the inspector supplies directly.

Each inspector connects from their own profile and enters:

- their Apple ID
- an **app-specific password** generated at appleid.apple.com — never their
  actual Apple ID password
- the calendar home, which is discovered rather than typed

## How it differs from Google

| | Google | Apple / CalDAV |
|---|---|---|
| Connect flow | `redirect` — an OAuth popup | `form` — fields collected in-page, no popup |
| Credential | OAuth tokens, refreshable | An app-specific password |
| Granularity | Scopes, so read-only is a real option | **All-or-nothing.** CalDAV reports no scopes at all |

That last row is the one to know before promising a customer read-only access:
with CalDAV there is no such thing. An app-specific password that can read the
calendar can write to it.

## Credential handling

The Apple ID, the app password and the discovered calendar home never leave
`server/lib/calendar/caldav/apple.ts`. Callers move an opaque `CalendarAuth`
handle from `resolveAuth` to a data-plane method and never read a field off it,
so no other module can reach the password even by accident. A handle stamped
with a different provider's id is rejected loudly rather than half-working
against credentials that mean nothing to this provider.

## When it is not configured

Nothing to connect on the profile; scheduling uses OpenInspection's own calendar
and working hours.

## When it breaks

CalDAV failures are per-inspector and surface on that inspector's calendar
status. The usual cause is a revoked app-specific password — Apple invalidates
them when the Apple ID password changes, and there is no refresh flow to recover
with, so the connection has to be re-entered.

## Where the code lives

- `server/lib/calendar/caldav/apple.ts` — the provider
- `server/lib/calendar/caldav/discovery.ts` — finding the calendar home
- `server/lib/calendar/caldav/client.ts`, `xml.ts`, `ical.ts` — the protocol

## Related

- [Google Calendar](google-calendar.md)
- [Integration adapters](../develop/integration-adapters.md)
