# Pinning Durable Objects to a jurisdiction

Collaborative editing, presence and the MCP session keep state in Cloudflare Durable Objects. By default an
object is stored wherever its first request lands. If your data has to stay in one jurisdiction, set
`DO_JURISDICTION` and the engine creates every new object inside it.

This page covers the setting, what it does and does not move, how to copy the documents that already exist, and what
to check afterwards.

## The setting

| `DO_JURISDICTION` | Effect |
|---|---|
| unset or empty | Nothing changes. Objects are unpinned, exactly as before. |
| `eu`, `us` or `fedramp` (any case) | Every new object is created inside that jurisdiction. |
| anything else | The worker throws on the first request. A typo can never leave objects silently unpinned. |

Set it as a plain variable in your Wrangler configuration and redeploy. It is read once per isolate, at the worker entry
(`pinDurableObjects`, `server/lib/collab/do-jurisdiction.ts`); no route or call site changes.

Four namespaces are pinned: `INSPECTION_DOC` (collaborative documents), `INSPECTION_PRESENCE`, `TENANT_PRESENCE` and
`INSPECTOR_MCP`.

## What it does not move

A Durable Object id for a name inside a jurisdiction is **different** from the id for the same name outside it. So an
object that already exists keeps its old location and its old id, and the pinned namespace cannot reach it: the first
request for that report after you turn pinning on creates a **new, empty** object in the jurisdiction, which builds its
document from the database.

To keep the old objects reachable, `pinDurableObjects` also exposes the namespaces as they were before pinning, as
`INSPECTION_DOC_UNPINNED` and `TENANT_PRESENCE_UNPINNED`. They are the same bindings; nothing extra to configure.
Two things use them: the copy below, and every delete.

## Deleting

Deleting an inspection, purging a workspace and the single-object purge each address **both** namespaces for the same
object name, so content created before pinning is destroyed as well. Purging a name that never existed in the old
namespace is a no-op, so this is safe to repeat. A failure in either namespace is reported the same way as before
(`failed` on the inspection audit entry, an incomplete `durable_objects` store on a workspace purge).

The single-object purge takes a Cloudflare object id from your logs. It tries the pinned namespace first and then the
old one, and its answer says which took the id (`namespace: "pinned"` or `"legacy"`). An id neither recognises is a 404.

## Copying existing documents

Until a document is copied, its editing history and restore points live in the old object, and the new object holds only
what the database has (the current values). Copy once per deployment, after turning pinning on.

**The database is not only written by the document.** Photo, annotation, sync, signing and re-inspection paths write a
report's results to the database directly (some delete a photo or clear a value), and the next save of a document replaces
the stored copy with the document's own contents. So the copy never imports an old document unless the document and the
database **agree**: findings only, every empty value counting the same (a cleared note equals a note never written), the
signature-style meta entries not compared, photo order counting. A document that lacks something the database gained would
take it away on the next save; one that has something the database since cleared would bring it back. When they differ
nothing is written and the row is a conflict with the reason `source-differs-from-database`. A dry run does not read the
database, so these conflicts appear only in a real run.

The copy is `POST /api/platform/collab-migrate`. It is served only by a deployment that exposes the platform
integration seam, and it is guarded by the same signed `x-portal-m2m` header as the other platform calls (the format is
documented in `server/lib/m2m-auth.ts`). A deployment without that seam has no HTTP trigger for it; the same functions
(`listCollabDocRefs`, `loadResultsBlobs`, `migrateCollabDocs` in `server/lib/collab/do-jurisdiction-migrate.ts`) can be run
from your own maintenance script with the two namespaces.

Body: `{ "cursor"?: string, "limit"?: 1-10 (default 5), "dryRun"?: boolean (default true), "replaceDerived"?: boolean (default false) }`,
or `{ "restoreBackupFor": "<rowId>" }` to undo one replacement (below). Every report names each row it handled by `rowId`
(the `inspection_results` row id, also the cursor), with its outcome, in `rows`; conflicts and skipped entries carry it too.

1. Page through once with the default `dryRun: true`. It touches no object. Read `total`, `wouldCopy` and `skipped`.
2. Page through with `"dryRun": false`. Each call handles at most `limit` documents and answers with `nextCursor`; send
   it back as `cursor` until it is `null`. A call is at most three object requests per document plus two database queries (about 32 in all at ten documents; if the
   batch database query throws on a malformed row, the check falls back to one query per row and a call is about 41, still
   under a worker's limit of 50). Every call writes one `collab migrate batch` log line with the counters and the row ids.
3. Read every list in the result:

| Field | Meaning | Action |
|---|---|---|
| `copied` | Copied into the new object. | None. |
| `alreadyThere` | The new object already holds exactly this document. | None. |
| `empty` | The old object holds no document. | None. |
| `replaced` | A database-built target was replaced by the old copy (audited, undoable). | None. |
| `conflicts` | The row was left alone. Each entry has both object ids, both sizes and a `reason`. | Decide, see below. |
| `skipped` | `no-report-id`: no object name can be derived. `identity-mismatch`: the object's stored identity names another tenant, inspection or report than the row. | Investigate. Never guessed at. |
| `failed` | A transport or storage error, named. | Fix the cause and run again. |

The old object is never changed or deleted by the copy. It is asked to export, and an export first stores whatever the
object's open sockets have sent, so an old object that still has live editors writes its own storage and database row
before it answers. Nothing is merged: an import into a target that already holds anything is refused.

Two code paths address only the pinned namespace, so a flush or a finding-key rename never reaches an old, unpinned
object: `doc-lock-notify.ts` and `finding-key-migration.ts` under `server/lib/`.

### Conflicts

`reason` says why a row was left alone:

- `source-differs-from-database`: the database and the old document disagree in either direction (see above). Compare the
  report in the database with the old object and decide by hand.
- `source-unreadable`: the old document could not be decoded, so it is not copied. `database-row-unreadable`: the row's
  stored results could not be parsed; the rest of the batch carries on and the cursor advances.
- `target-has-state`: the target holds a document, usually one built from the database after you turned pinning on. If
  you are content to let the old copy win over a target nobody edited, page through again with
  `"dryRun": false, "replaceDerived": true`.
- `target-edited`: a client has changed the target since it was built from the database.
- `target-live`: the target has open sessions or changes waiting to be saved. Try again later.
- `target-unsaved`: the target was built from the database but was evicted before its first save, so it has no stored
  document yet. Open the report or try again later.
- `target-identity-mismatch`: the target carries another document's identity.

A row is reported as a `source-differs-from-database` conflict even when the target already holds exactly the source bytes. That
is conservative and cosmetic: nothing is written either way.

The last four are never replaced automatically. Compare the report in the database with both objects and decide by hand.

### What `replaceDerived` discards, and what protects you

It discards the **target's own document and its own restore points**: the pinned object's document, built from the database
and never edited, is replaced by the old object's document, and the old object's restore points replace the target's. Two
preconditions guard that, and both must hold:

1. The old document agrees with the database (above), so nothing the database holds is lost or brought back.
2. The target is not live, its stored identity matches the row, and it still carries the `derived-from-d1` marker. The
   object sets that marker when it builds its document from the database and clears it on the first later change from any
   source (a client edit, a follow-up answer, a key rename), so no edit made in the pinned object is lost. A target created
   by a build older than the marker has no marker and stays a conflict.

The displaced **document** (not its restore points: a restore brings back only the document, the target's restore points stay
the replacement's, and the ones the replacement displaced are gone) is stored in the object under `replaced-derived-backup` in the same
atomic write as the replacement. That one write carries the document, the backup and the restore points together; a value
over the 2 MB per-value limit makes it fail before anything is written, the row is reported `failed`, and such a document
cannot be replaced. Each replacement logs one audit line with both object ids, both sizes and the SHA-256 of both documents.

To undo one, send `{ "restoreBackupFor": "<row id>" }` (use the `rowId` the report names for that document, in `rows`, `conflicts` and `skipped`, and in the `collab migrate batch` log line). It ignores `dryRun` by design: it is an
explicit, separate write, and it is refused if mixed with batch fields. Three guards, each refusing without changing anything:
the backup must still agree with the database (`backup-differs-from-database`), the replacement must still be exactly what
was written (`target-edited` once any client edit has persisted, so a restore can never discard an edit), and the object must
not be live. It answers 404 when there is no backup. On success the backup goes back, marked database-built again, and the
stored backup is spent.

**Timing.** An old object whose save alarm was armed before the deploy still runs it, and that save writes the old document's
projection to the database. This is harmless to the check, because the two then agree; but an alarm that fires between the
check's database read and the import would leave the copy one save behind. Wait a minute after deploying before the real
pass.

Until `conflicts`, `skipped` and `failed` are empty or resolved, the old objects are the only copy of those documents'
history, so leave them be. Deletes keep reaching them through the old namespace either way.

## What to check in production

Only your deployment can show these; the test suite cannot, because the local runtime does not implement jurisdictions.

1. After redeploying with `DO_JURISDICTION` set, open a **new** report and confirm in the Cloudflare dashboard that its
   object is listed under the jurisdiction. Confirm an existing report still opens.
2. Run the dry run and compare `total` with the number of rows in `inspection_results` that have `ydoc_state`.
3. After the real pass, `copied + alreadyThere + empty + replaced + conflicts + skipped + failed` must equal `total`
   across all batches.
   Look at `conflicts` with reason `source-differs-from-database` before anything else: each is a report that was written
   to directly after the old object last stored it.
4. Delete a test inspection and confirm both the pinned and the old object for its report are empty (the delete's audit
   entry reports `collabPurge: "ok"`).
5. Check that the single-object purge answers with a `namespace` for an id taken from your logs.
