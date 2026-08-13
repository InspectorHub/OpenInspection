# Collaborative Inspection Editing (Yjs + Durable Objects)

OpenInspection edits an inspection's **results** (the per-item findings: ratings,
notes, canned comments, custom defects, attributes, photos, repair items) as a
**Yjs CRDT document** hosted in a Cloudflare **Durable Object**. Multiple
inspectors can edit the same inspection at once; edits merge automatically with
no lost-update conflicts, work offline, and are versioned.

This replaced the previous per-field compare-and-swap (CAS) write endpoints, the
bespoke offline queue, and the diff3 conflict-resolution UI — all retired (#181).

## Architecture

```
browser (React editor)
  │  Y.Doc  ── y-indexeddb (offline buffer, db: results-<inspectionId>)
  │  └── WebSocket (y-protocols/sync framing)
  ▼
GET /api/inspections/:id/collab/ws   (server/api/inspections/collab.ts)
  │  5-check fail-closed auth (binding · id · JWT tenant+user · tenant-scoped
  │  inspection lookup · caller-is-on-inspection), then forwards the WS upgrade
  ▼
InspectionDocDO   (server/durable-objects/inspection-doc.ts)
  │  holds the authoritative Y.Doc · WebSocket hibernation · projection + persist
  ▼
D1 inspection_results
      .data        ← projectResults(doc)  (the report-consumed JSON projection)
      .ydoc_state  ← Y.encodeStateAsUpdate(doc)  (the binary CRDT state)
```

- **One DO per inspection**, addressed by a tenant-scoped name:
  `INSPECTION_DOC.idFromName(`${tenantId}:${inspectionId}`)`. The authorized route
  is the sole trust boundary; the DO trusts the `x-tenant-id` / `x-inspection-id` /
  `x-user-id` headers the route forwards.
- **The DO is the only writer of `inspection_results.data`.** It debounces a
  `persist()` that writes both the JSON projection (`data`, what the report and
  every non-editor reader consume) and the binary Yjs state (`ydoc_state`). A
  durable alarm backstops the debounce across hibernation, and a flush runs on the
  last disconnect.
- **Hydration**: on first connect the DO seeds the full template structure
  (every finding key — Condition A, so concurrent lazy-creates can't drop data)
  and, only if it has no stored state, imports the existing `inspection_results.data`
  blob via `loadResultsProjection`. Subsequent reconstructions (hibernation) restore
  from DO storage in the constructor (`blockConcurrencyWhile`).

## The projection model

`server/lib/collab/results-doc.ts` is pure Yjs (no React, no server deps) and owns
the document shape + the projection that is its exact inverse:

- `projectResults(doc)` → the plain-JSON `ResultMap` written to `inspection_results.data`.
  It omits empties so the shape matches the legacy blob exactly — **all existing
  readers (report renderer, analytics, recommendations) are unchanged.**
- `loadResultsProjection(doc, projection)` → rebuilds a doc from a projection
  (used by hydration and by version restore).
- Field model: scalars (rating/notes/value/…) are last-writer-wins per field;
  containers are CRDT-merging — `attributes` (Y.Map), `photos` (Y.Array of Y.Map,
  keyed by `key`), canned-comment tabs, `customComments`, and `recommendations`
  (Y.Arrays keyed by id). Concurrent edits to different fields/items always both
  survive; concurrent appends both survive.

## Offline editing & multi-user merge

- **Offline**: `y-indexeddb` persists the Y.Doc and every local update to IndexedDB
  (`results-<inspectionId>`). While offline the WebSocket send is skipped but the
  update is durably buffered locally — it survives a page reload.
- **Reconnect**: a bidirectional y-protocols sync handshake runs (each side sends a
  sync step1, the other replies step2). The client's offline edits flow to the DO
  and the DO's accumulated edits (other users, made while this client was offline)
  flow to the client. **Yjs (YATA) merges automatically, with no lost operations.**
- **Same-field concurrency**: two users setting the same scalar field resolve
  deterministically (last-writer-by-clientID). No operation is "lost" in the CRDT,
  but one value wins — the **version history** surfaces the overwritten value so it
  is recoverable.
- **Network-only operations**: photo/video binary upload and crop/annotate image
  baking require a connection (they write to R2). Offline, the editor declines these
  with a "needs a connection" notice; all field data and photo array operations
  (reorder/detach/move/revert) work offline.

## Version history & restore

`server/durable-objects/inspection-doc.ts` keeps periodic (every 20 real edits) and
on-demand JSON-projection snapshots in DO storage (capped at 25, `{seq, atMs, byUserId}`).

- Routes (authorized, same auth as `/ws`): `GET …/collab/snapshots` (list),
  `POST …/collab/snapshots` (capture now), `POST …/collab/restore {seq}`.
- **Restore is doc-replacement** (Condition B), NOT `Y.applyUpdate` of an old state
  (that is a CRDT no-op). The DO captures the current state first (so restore is
  itself reversible), rebuilds a fresh Y.Doc from the snapshot's projection, swaps it
  in, persists, and broadcasts a **MSG_RESTORE** control frame. Every connected
  client drops its local Y.Doc + IndexedDB and resyncs from scratch — so a restore
  converges all live clients (a plain additive update could not revert deletions).
- UI: the **Version history** panel in the editor (`app/components/collab/VersionHistoryPanel.tsx`).

## Configuration

The Durable Object must be bound in every deploy target.

- `wrangler.jsonc` (committed; standalone + one-click): already declares the
  `INSPECTION_DOC` → `InspectionDocDO` binding and the `v2` SQLite-class migration.
- `wrangler.saas.jsonc` (gitignored SaaS config): must include the same binding +
  migration tag:

  ```jsonc
  "durable_objects": {
    "bindings": [
      // …existing presence bindings…
      { "name": "INSPECTION_DOC", "class_name": "InspectionDocDO" }
    ]
  },
  "migrations": [
    // …existing v1…
    { "tag": "v2", "new_sqlite_classes": ["InspectionDocDO"] }
  ]
  ```

When `env.INSPECTION_DOC` is absent the collab routes return `501` (feature
unavailable) and fail closed — collaborative editing simply does not engage.

## What was retired (#181)

Per-field CAS write endpoints (`PATCH /:id/items/:itemId`, `POST /:id/results/merge`),
`server/lib/field-version.ts`, the diff3 + conflict services, the bespoke offline
queue (`app/lib/offline/*`, `useOfflineQueue`/`useOfflineWrite`), the conflict UI
(`ConflictModal`/`LiveConflictModal`/`conflict-resolver`), and the
`inspection_conflicts` table. Yjs supersedes all of them.

## Key files

| File | Role |
|---|---|
| `server/durable-objects/inspection-doc.ts` | the DO: Y.Doc host, WS sync, persist, snapshots/restore |
| `server/api/inspections/collab.ts` | authorized WS + snapshot/restore routes |
| `server/lib/collab/results-doc.ts` | pure Yjs doc model + `projectResults` / `loadResultsProjection` |
| `app/lib/collab/results-doc-connection.ts` | browser Y.Doc ↔ DO connection (offline + restore resync) |
| `app/lib/collab/use-results-doc.ts` | React hook over the connection |
| `app/lib/collab/results-binding.ts` | doc ↔ editor write-API bridge |
| `app/components/collab/VersionHistoryPanel.tsx` | version-history UI |
