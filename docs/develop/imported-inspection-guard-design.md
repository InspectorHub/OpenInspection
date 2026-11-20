# Design: central gate that keeps imported inspections read-only

This document describes the **mechanism** for enforcing that inspections restored
from a data package are not modified through the live API. It is a design note,
not an implementation; the product reasons for the rule live elsewhere.

## Problem

A restored inspection is an immutable copy. Every write endpoint that accepts an
inspection id must refuse it, while read/download/print, "copy as new report",
and a narrow set of deliberate operations on an already-published version must
keep working. The check must be central: a per-route guard is one a new route
forgets to wear.

The marker is already available: an inspection is imported iff `import_id_map`
has a row with `table_name = 'inspections'` and `new_id = <inspection id>`.
That row is never removed, so the check is stable.

## Shape (mirrors the existing report-authoring / report-lock guards)

A single path-scoped middleware, mounted in `server/index.ts` **after** the JWT
and capability guards (so an unauthorised caller still gets their 403 first) and
**before** the routers:

```
app.use('/api/inspections/*', importedInspectionGuard)
```

The middleware:

1. Lets `GET` / `HEAD` / `OPTIONS` through without a DB read — reads are never
   affected.
2. Extracts the inspection id from the path (`/api/inspections/:id/...`).
3. If the path is in the **allow list** (below), passes through.
4. Otherwise checks the `import_id_map` marker for `(tenantId, new_id)`.
   - imported → `409 IMPORTED_INSPECTION_READ_ONLY` with a fixed error code,
     no row content in the response.
   - not imported / no id / no tenant → pass through.

The DB read is one indexed lookup (`idx_import_id_map_new_id`) and happens only
for mutating requests on non-allow-listed inspection paths.

## Allow list (operations that remain legal)

These are the paths that must stay writable for an imported inspection. They
are explicit and each carries a reason in the conformance test:

- `POST /api/inspections/:id/copy-report` — copies into a NEW inspection, which
  is not imported and consumes a normal allowance.
- `POST /api/inspections/:id/unpublish` and `POST /api/inspections/:id/publish` —
  withdraw/restore publication of an **already existing** report version. They
  do not create or alter the archived evidence. Creating a NEW report version
  is NOT allow-listed and stays refused.
- Reads that use a mutating verb (e.g. a POST used as a search) are classified
  with a reason rather than silently left out of the gate. Note that
  `collab/restore` restores Yjs document history, not publication state, and is
  therefore NOT allow-listed.

Paths outside `/api/inspections/*` that carry an inspection id in the **body**
(the offline package import, the collaborative document socket) cannot be
answered with a 409 and check the same marker inside their own service layer;
this is the same split `report-lock-guard` uses.

## Coverage / conformance (the part that keeps it honest)

A table-driven spec enumerates every mutating route under `/api/inspections/*`
from the OpenAPI snapshot and asserts each one is either:

- covered by the gate (inspection id in path, not in the allow list), or
- in the allow list with a non-empty reason, or
- explicitly classified as "does not target an imported inspection" with a
  reason.

A new mutating route that is neither covered nor justified fails the test — the
same invariant `report-lock-conformance.spec.ts` and
`report-authoring-guard.spec.ts` enforce today. A positive control proves a
normal (non-imported) inspection is still editable, so the gate cannot pass by
rejecting everything.

## Lock order

`importedInspectionGuard` runs alongside the other inspection guards. Order:

1. inspection scope guard (visibility refusal first),
2. report-authoring guard (capability refusal),
3. report-lock guard (published-content refusal),
4. **imported-inspection guard** (read-only refusal).

An unauthorised caller therefore sees their 403 before any hint about import
state, matching the existing guards' ordering rationale.

## Tests (red first)

- imported inspection: a representative write (results edit, new report
  version, resend, new invoice, new agreement, re-inspection) returns the fixed
  code; no row content in the body.
- allow-listed copy-as-new succeeds and creates a non-imported inspection.
- a non-imported inspection still accepts the same writes (positive control).
- conformance: every mutating route is covered or justified with a reason.
- no DB read for a GET or for a path with no inspection id.
