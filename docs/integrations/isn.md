# ISN — report links on ISN orders

For companies that book and bill through ISN (Inspection Support Network) and
write reports here. When a report is published, its link is added to the ISN
order it belongs to, so the client and agent find it where ISN already sends
them.

This is the report half of
[InspectorHub/OpenInspection#321](https://github.com/InspectorHub/OpenInspection/issues/321).
Importing ISN's scheduled orders is not built yet.

## What you need

| Key | Where |
|---|---|
| `ISN_DOMAIN` | The address you sign in to ISN at, host only: `https://inspectionsupport.com`, or your white-label domain |
| `ISN_COMPANY_KEY` | ISN → Settings → My Access Keys |
| `ISN_ACCESS_KEY` | Same page |
| `ISN_SECRET_KEY` | Same page |

Set them in Settings → Advanced → ISN. All four are **tenant-owned**: the
company's own value always beats a Worker env binding, because a platform key
winning would put every company's reports on one company's ISN account.

ISN access keys never expire and carry the full permissions of the ISN user who
owns them — issue them from a user whose permissions match what this needs.

There is no default domain. ISN is white-labelled, and a guessed host fails
looking exactly like a wrong key.

## How it is used

1. Put the ISN order number (the one ISN shows on the order) in the
   inspection's **Reference Number**. An inspection without one is not sent.
2. Publish a report. After the publish succeeds, the link is added to that ISN
   order as a public report — it appears in the order's Inspection Reports
   area with **Public** ticked, which is what puts it on the client's ISN
   report-delivery page. The link carries the primary client's portal token;
   republishing sends the same link again.
3. The row is read back from ISN before the sync counts as done. The outcome is
   returned as `isnSync` on the publish response.

ISN treats the newest report on an order as the one it emails and downloads,
so each publish adding a row is intended.

### This app's gates still apply

The link is this app's own report link, so this app's agreement, payment and
report-release gates apply to it exactly as they do to any other link it
issues. ISN's own delivery hold may apply as well, so a client can be asked to
sign or pay in both places. Letting ISN hold or release those gates is not part
of this integration.

## When it is not configured

Nothing happens on publish and `isnSync` is `null`. The same is true for an
inspection with no Reference Number.

## When it breaks

The publish is never undone: a report that did not reach ISN is still
published. `isnSync` comes back `{ ok: false, error }` with ISN's own message,
and the failure is logged. Our own missing data (no client email to issue a
link for) is named before any call to ISN.

Two ISN behaviours that are not in its published API document, both verified
against a live company and pinned in `tests/contract/isn/isn-api.live.spec.ts`:

- **Errors arrive as HTTP 200** with `{ "status": "error", "message": ... }`.
  Success is the body's `status`, never the status code.
- **`addreporturl` reads the query string.** The document says form-encoded
  body; a form body is answered "you must provide a url for the report".

Deleting a report row in ISN hides it (`show: false` in `/orderfiles`) rather
than removing it, so the read-back requires the row to be shown.

## Where the code lives

- `server/services/isn/api-base.ts` — credentials, the call, error shape
- `server/services/isn/report-link-payload.ts` — pure: the fields ISN reads
- `server/services/isn/report-link-sync.ts` — the push and the read-back
- `app/components/settings/advanced/IsnPanel.tsx`, `app/lib/isn-settings.server.ts` — the settings panel
- `tests/contract/isn/` — the vendored schema excerpt, its contract spec, and the live spec

## Related

- [Integration adapters](../develop/integration-adapters.md)
- [QuickBooks Online](quickbooks.md)
