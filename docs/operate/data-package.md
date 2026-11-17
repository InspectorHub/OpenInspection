# Operating tenant data packages

The tenant data package is a desktop-owned export. The engine exposes a small
read API and never assembles the archive; the desktop app does the paging,
hashing, zipping and verification on the operator's machine. Operators who need
to hand a package to a customer, or confirm one is intact, use the offline
verifier described below.

## What the server exposes

Owner-only endpoints under `/api/admin/data-package/`, authenticated with a
native bearer token and (on data endpoints) a short-lived `X-Data-Job` token:

- `POST /jobs`, `/heartbeat`, `/resume`, `/complete`, `/abort` — lease ledger.
- `GET /jobs`, `GET /jobs/:id` — job status (also used by the web status page).
- `POST /jobs/:id/cancel` — bearer-only cancellation for the web page.
- `GET /jobs/:id/tables`, `.../rows` — classification-derived table descriptors and keyset pages.
- `GET /jobs/:id/media`, `.../media/object?key=...` — media listing and RFC 9110 Range streaming.

Application-layer daily budgets are disabled. `X-Dp-Budget` is emitted as a
measurement header only and never returns 429; the D1 platform's physical
limits still apply and surface as ordinary errors.

## Verifying a package offline

After an export, re-check the directory with the same code the importer uses:

```bash
npm run build -w @inspectorhub/data-package   # ensure dist/index.js exists
node scripts/verify-data-package.mjs /path/to/package
```

The script is fully offline. It reads only the given directory and prints one
line per check (`OK` / `FAIL`) and a final tally. It exits `0` when every check
passes, `1` when any check fails, and `2` on a usage or missing-package error.
A package that runs no checks is treated as a failure, never as a pass.

It verifies:

- the manifest is canonical and the root zip stays within classic zip limits;
- `checksums.sha256` lists exactly the manifest's files plus the media index, with matching digests;
- every listed file's size and digest match, NDJSON rows parse safely and their count matches;
- the media index verifies against the manifest (digest, row count, per-volume totals);
- each media volume's digest matches and every object's digest matches its index row.

This is a release-time / customer-handoff rung, not a CI job: it reads files
that belong to real companies and must never be committed to a public repo.

## Plaintext handling

A package is plaintext and contains personal information, signed records and
financial data. After a purge it is the only surviving copy. Keep it on an
encrypted volume, limit who can copy it, and delete it through the customer's
retention process when no longer needed. There is no passphrase option. See
[the format reference](../reference/data-package-format.md) for the on-disk
layout and limits.

## Web entry

The web app keeps only a minimal entry (Settings → Data): a link that opens the
desktop app via the `io.inspectorhub.app` protocol, a neutral explanation that
the export runs locally, and a job-status page where an owner can see and
cancel active jobs. There is no in-browser export driver; every platform uses
the Electron desktop app.
