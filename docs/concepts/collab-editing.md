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

## One document per REPORT, not per inspection

The Durable Object's name comes from `server/lib/collab/doc-name.ts` and is
`${tenantId}:${reportId}`.

It used to be `${tenantId}:${inspectionId}`, and that was a silent corruption
path: an order can carry several reports, so two inspectors working the standard
report and the sewer report of the same order landed in the **same** Durable
Object and shared one Y.Doc. Nothing threw. The CRDT merged content belonging to
two different documents, and it surfaced only when somebody opened a report
containing another report's findings.

⚠️ **Re-keying the address was not enough, and the second path is the instructive
one.** The object also writes its projection back to D1, and that write was keyed
on `inspection_id`. Since an inspection now has one `inspection_results` row *per
report*, that predicate matched every one of them — so a correctly routed radon
document would still have overwritten the standard report's row. The same
corruption, one layer down, and just as silent. The object now carries an
`x-report-id` header and writes by `report_id`, falling back to the inspection
predicate only when it does not know one (an object woken before any client has
connected).

The derivation lives in its own function so a test can assert the thing that
actually matters. Two report ids are trivially unequal, so a test that compared
only the OUTPUTS would pass just as well against an implementation still keyed on
the inspection. What has to be true is that the inspection id is not an input.

`INSPECTION_PRESENCE` is deliberately still keyed per inspection. It persists no
document, so it has no corruption path — the only question it raises is whether
two people editing different reports of one order should see each other, and
showing them as present on the same order is defensible. Treat that as a UX
question, not a correctness one.

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

## Who may write finding content to D1

**While collab editing is on, finding content is written through the Durable
Object. Code must not write it straight to `inspection_results.data`.**
"Finding content" is everything an item carries: rating, notes, value, canned
and custom comments (tabs), attributes, photos, recommendations, the
re-inspection `original` and follow-up fields.

The reason is the persist. The object holds the authoritative document, and its
every persist (`writeResultsProjection` in `server/durable-objects/inspection-doc-d1.ts`)
replaces `data` wholesale with the projection of that document. A direct write
that the document does not know about is therefore either invisible in the
editor or erased by the next persist, and nothing reports it. The same applies
to the *keys*: the document only ever holds the keys it was given.

What is allowed is deliberately narrow:

- the object's own projection write;
- a **narrow, non-finding field** (a meta key such as `_inspector_signature`, or
  `report_id` on the row);
- creating a row for something the object has never seen (a new inspection, an
  empty seed row);
- a write the caller **skips when collab is on** (the `skipResultsWrite` option of
  the Media Studio routes, which return the derived key for the client to mirror
  into the document).

### Direct writers of `inspection_results`, and where each stands

Verified by reading every `insert` / `update` / `delete` of `inspectionResults`
under `server/`.

| Writer | What it writes | Verdict |
|---|---|---|
| `server/durable-objects/inspection-doc-d1.ts` | the document projection | **The writer.** |
| `server/lib/inspection/primary-report.ts` | sets `report_id` on an orphan row; inserts a row with empty `data` | Acceptable: no finding content. |
| `server/services/inspection/inspection-reinspection.service.ts` | the seeded blob of a brand-new re-inspection, under a brand-new report id | Acceptable: no object exists for that report yet; its first connect hydrates from this blob. |
| `server/lib/inspection/reports.ts` | deletes the row of a deleted report | Acceptable: no content written. |
| `server/services/inspection/inspection-annotations.service.ts` | `annotatedKey` / crop metadata on a photo | Acceptable only through the `skipResultsWrite` path, which the Media Studio routes take when collab is on. A caller that omits the option writes straight to D1. |
| `server/api/admin/admin-finding-keys.ts` (through `server/lib/inspection/finding-key-migration.ts`) | legacy key rename | Acceptable: rows without collab state are rewritten in D1; rows with collab state are renamed inside the document by the object (see below). Meta keys are never rewritten. |
| `server/lib/inspection/auto-sign.ts`, `server/api/inspection-sync.ts` (inspector signature) | the `_inspector_signature` meta key | Acceptable: a meta key, not a finding, and the persist preserves meta keys (see "Meta keys" below). |
| `server/api/inspection-sync.ts` (photo delete) | splices an item's `photos` | **Not acceptable** while collab is on. Also addresses the item by its bare id. |
| `server/services/inspection-results.service.ts` (`applyResultsBatch`, behind the results batch route) | rating, notes, value, canned, defect fields, attributes | **Not acceptable** while collab is on. |
| `server/services/inspection/inspection-results.service.ts` (`updateResults`, `switchRatingSystem`) | merges whole results, remaps every rating | **Not acceptable** while collab is on. |
| `server/services/inspection/inspection-photo.service.ts` (`attachPoolPhoto`, `reorderItemPhotos`, `detachItemPhoto`, `revertPhotoEdits`, `moveItemPhoto`) | photo arrays | **Not acceptable** while collab is on. |
| `server/services/unit-switch.service.ts` (`toPerUnit`, `toTagged`) | rewrites every key | **Not acceptable** while collab is on. |

The rows marked not acceptable are known gaps, listed here so the rule is not
mistaken for a description of the code as it stands. A fix routes the change
through the object (the `/followup` and `/rename-legacy-keys` verbs are the
pattern) or skips the D1 write when collab is on.

### Meta keys

A key that starts with `_` and has fewer than three colon-separated parts
(`_inspector_signature`) is a meta key: row-level data that lives in the blob
next to the findings but is not one. Composite finding keys also start with
`_default:`, which is why the colon count decides (`isMetaKey` in
`server/lib/finding-key.ts`, the one definition every module uses).

The engine generates item ids as UUIDs, so a real finding never looks like a meta
key. A template imported from elsewhere whose item id starts with `_` and has no
colon would be treated as one: its content stays in the row untouched but is not
loaded into the document, so it cannot be edited collaboratively.

- The document **never holds a meta key**. Importing a blob skips them
  (`loadResultsProjection`) and projecting a document skips them
  (`projectResults`), so a document that was imported before this rule and still
  holds an empty item map for one does not leak it into the blob either.
- The persist **keeps whatever meta keys the row holds**. Before replacing `data`
  with the projection, `writeResultsProjection` reads the row it is about to
  write (same tenant and report scope as the write) and merges its meta keys into
  the new blob. Meta keys come from the row only, never from the document. This
  is what lets the signing routes (`auto-sign.ts`, the inspector-signature route
  in `inspection-sync.ts`) keep writing the signature straight to the row.
- If that read fails the persist throws before writing anything: the document
  has already been stored in the object, and the alarm that follows every edit
  retries the whole write. Writing without the read would risk the exact loss the
  read exists to prevent, so a failed read behaves like any other D1 failure.
- The read and the write are two statements. A signature saved in the instant
  between them is overwritten by the older value just read, and a later save of
  the signature (publishing signs again when auto-sign is on) puts it back. The
  window is one round trip wide and the loss is of a value that can be redone.
- The signature is not moved into the document, which would remove the window
  and the special case. That is a larger change (a document field, a client
  surface and a migration of existing rows) and is not done here.

A signature that an earlier version of the persist had already replaced with
`{}` is gone from the row; nothing here brings it back.

### Legacy finding keys

Old results were keyed by the bare item id; the key today is
`_default:<sectionId>:<itemId>`. `POST /api/admin/migrate-finding-keys` (owner
only) converts them, and it must respect the rule above. Where the work happens
is decided per results row:

- A row **with** collab state (`ydoc_state` is not null) is **always** handed to
  its document, whatever the blob looks like. The blob cannot say what the
  document holds: an older migration that rewrote only the blob leaves composite
  keys in D1 while the document keeps the bare ones, and the document's next
  persist writes the bare keys back.
- A row without collab state is also handed to its document when the deployment
  has the `INSPECTION_DOC` binding, the tenant has collaborative editing on (a
  missing setting counts as on, as in the session), the inspection has exactly
  one results row, and the blob holds a key the template names. A document with
  no stored state imports the blob when it loads, so it renames and persists in
  one place, and there is no race with edits it has not flushed yet. With several
  results rows the object's blob import cannot tell the reports apart, so those
  rows stay on the D1 path.
- Everything else (no binding, collaboration off, several results rows) is
  rewritten in D1. Keys that start with `_` (without being composite) are meta
  keys and are never rewritten. A legacy value never replaces a composite entry
  that holds content; an empty composite entry (the template seed) is replaced.
- A row with collab state and no binding to ask is counted as failed. It is not
  rewritten in D1.

To "hand a row to its document" is `POST /rename-legacy-keys` on the object of
that report (same tenant-scoped id as the collab routes). It loads the document
if needed, and if any key can move it first takes a version-history snapshot
with reason `pre-rename` (nothing is renamed if that fails). Then, in ONE
transaction, it moves each bare-keyed item whose id belongs to exactly one
section of the inspection's template snapshot onto its composite key, copying
every field of the item map, and persists in the usual way. Field rules:

- an empty composite field takes the legacy value;
- nested maps (`tabs`, `customComments`, `attributes`, `original`) merge
  sub-field by sub-field;
- arrays (photos, canned and custom comments, recommendations) are unioned,
  deduplicated by element content, composite elements first;
- a scalar where both sides hold different content keeps the composite value
  (it is what someone edited in the new structure) and counts one conflict. The
  legacy value then survives only in the `pre-rename` snapshot, retained like any
  other snapshot (the ring keeps the last 25).

Meta keys, ids that are not in the template, and ids that sit in more than one
section are left alone and counted. A second run changes nothing. The object logs
`collab_legacy_keys_renamed` with `{ inspectionId, renamed, conflicts }` (numbers
only) whenever it renamed something, and answers
`{ renamed, skippedMeta, skippedUnknown, skippedAmbiguous, conflicts }`.

The migration responds with `{ processed, migrated, skipped, delegated, failed,
failedIds, renamedInDocuments, conflicts }`. Every results row examined ends in
exactly one of `migrated`, `delegated`, `failed` or `skipped`, and `processed` is
their sum; an inspection with no results row counts nowhere. `delegated` means the
document was asked and answered (not that it moved anything: that is
`renamedInDocuments`, summed over documents, next to their summed `conflicts`).
`failed` and `failedIds` name the inspections whose document could not be asked
or refused, and one failure does not stop the batch.

There is deliberately no automatic healing when a document loads, and the
hydration rule is unchanged: a document with stored state does not re-import D1.

### The divergence log line

Because that rule has a blind spot, hydration of a document **with** stored state
logs one warning, `collab_d1_divergence`, when the D1 blob and the document
disagree. Its data is `{ inspectionId, divergentFindings }` and nothing else.
`divergentFindings` is the number of findings whose blob entry has a non-empty
rating or notes while the document's entry for that key is missing or has
neither (meta keys are not counted). It is log-only: it changes no data and
swallows its own failures.

The blob compared is the results row of the document's own report when the
object knows its report id (an extra tenant-scoped read, no side effect). Only
when it does not, the comparison falls back to the row the hydration read took,
which is whichever row of the inspection it reached first: **on an inspection
with several reports that count is not reliable** and may describe a sibling's
row. The hydration read itself is unchanged by this.

How to read it: a one-off line right after a deploy or a migration points at a
direct write that bypassed the object (compare with the table above); the same
inspection repeating on every wake means something keeps writing around the
document. The line says *that* they differ, not which is right: the document is
authoritative, and its next persist overwrites the blob.

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
| `server/lib/collab/legacy-key-rename.ts` | pure Yjs rename of legacy finding keys, run by the DO's `/rename-legacy-keys` |
| `server/durable-objects/results-divergence.ts` | the log-only blob-vs-document divergence check |
| `app/lib/collab/results-doc-connection.ts` | browser Y.Doc ↔ DO connection (offline + restore resync) |
| `app/lib/collab/use-results-doc.ts` | React hook over the connection |
| `app/lib/collab/results-binding.ts` | doc ↔ editor write-API bridge |
| `app/components/collab/VersionHistoryPanel.tsx` | version-history UI |
