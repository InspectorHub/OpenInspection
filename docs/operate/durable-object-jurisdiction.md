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

## Switching it on: the order

A pinned object starts **empty** and, on the first request for a report, rebuilds its document from the database with a **new generation id**. If a report that has not been copied yet is opened, that starts a new lineage, and older local copies held by browsers can be merged into it. Content that the direct write paths (photo, signature and sync paths write straight to the database) removed from the database since the old object last stored it can then reappear. So from the deploy until every document is migrated, nobody should open reports.

**The engine has no switch that stops editing.** There is no maintenance mode, and the tenant-suspension check does not cover a WebSocket upgrade. Keeping editors out is something you arrange yourself, for example by taking the app offline at your edge for the window, or by not deploying while anyone has a report open. Deploying usually restarts the Durable Objects and drops open editor sockets; the editor reconnects on its own after a close (with a backoff), and a reconnect to a not-yet-migrated report creates the empty-then-rebuilt object this order is meant to avoid. So block traffic to the Worker for the window; do not rely on telling people to stay out. This is Cloudflare's usual behaviour plus the client's reconnect logic, not something this repository tests: try the whole order once on a staging deployment before production.

1. **Make sure the build contains the lineage guard** (`docs/concepts/collab-editing.md`, "Lineage guard"). It must be live before any `replaceDerived` pass.
2. **Block traffic to the Worker** (see above) and keep it blocked until step 7.
3. **Deploy with `DO_JURISDICTION` set.** The old namespaces stay bound as `INSPECTION_DOC_UNPINNED` and `TENANT_PRESENCE_UNPINNED`. Wait a minute (see "Timing" below).
4. **Dry run.** Page through the migration with `dryRun: true` (the default) until `nextCursor` is `null`. Nothing is written. `total` is per call: add up `total` over all pages and compare it with the number of `inspection_results` rows that have `ydoc_state`.
5. **Real run.** Page through with `"dryRun": false` until every document is migrated. Per call, `copied + alreadyThere + empty + replaced + (number of entries in conflicts) + (number in skipped) + (number in failed)` must equal that call's `total` (`conflicts`, `skipped` and `failed` are lists in the response, not counts; `wouldCopy` appears only on a dry run). If any list is not empty: `conflicts` and `skipped` as described under "Conflicts"; `failed`: fix the cause and run the same page again (re-running a whole page is safe).
6. **`replaceDerived` is the exception, not a step.** Use `"replaceDerived": true` only for rows reported as `target-has-state` on a target that still has the `derived-from-d1` marker. `restoreBackupFor` undoes one such completed replacement (`replaced`). Neither is a way to fix a document that someone edited.
7. **Reopen.** Only now let traffic and editing back in.

The migration routes exist only on the SaaS profile (`APP_MODE=saas`, `getDeploymentProfile(env).hasPortalIntegrationApi`). On a standalone (non-saas) deployment they answer 404; run the functions from a maintenance script instead (see "Copying existing documents"). Steps 4 and 5 then mean running `listCollabDocRefs` and `migrateCollabDocs` the same way.

**If documents were opened anyway** you will see `target-has-state` conflicts (opened, not edited) and `target-edited` conflicts (edited): handle them as in "Conflicts". What the lineage guard rescues in that case: a browser that has a recorded generation id and runs a current bundle reports it, is refused with code 4410 when it differs from the rebuilt object's id, and discards its stale local copy (keeping one backup on the device), so it does not merge an old history into the rebuilt one. What it does not rescue: a client that sends no `gen` (a cached older bundle, the native client, a store written before the guard existed) can still merge its history until it reloads; the old object's editing history and restore points stay in the old object until the row is copied; and edits made in the rebuilt object are never copied back over, they are a conflict for a person to decide.

### What each step is, and how to check it

| Call | What it does | Check |
|---|---|---|
| `POST /api/platform/collab-migrate` with `dryRun: true` | Lists the rows from the database (up to `limit` per call, 1-10, default 5). It touches no object, writes nothing and does not read the results blobs. | `total`, `wouldCopy`, `skipped`. |
| same, `dryRun: false` | Per document: read the database blob, export from the old object (no document: `empty`), check the old document against the database (a difference is `source-differs-from-database`), then import. The import itself refuses a target that is not empty with a 409 and merges nothing; only after that refusal is the target's stored document compared with the source (base64 string equality): equal is `alreadyThere`, different is a `conflicts` row with the target's reason. | The counters and lists; one `collab migrate batch` log line per call. |
| same, `dryRun: false, replaceDerived: true` | Replaces a database-built target with the old document, keeping the displaced document as `replaced-derived-backup`. | `replaced`; one audit line with both ids and SHA-256 sums. |
| `{ "restoreBackupFor": "<rowId>" }` | Undoes one completed replacement: puts the displaced document back. | `{ restored: true }`, or 404 (no such document or no backup) / 409 / 502 with the reason. |
| `POST /api/platform/tenants/:slug/inspection-doc/purge` with `{ "durableObjectId": "<64 hex>" }` | Empties one object by its Cloudflare id, only if the object belongs to the tenant in the path. Tries the pinned namespace, then the old one. | `namespace: "pinned"` or `"legacy"`. Errors: 400 invalid body; 403 the object stores another tenant's identity, or holds a document but no identity; 404 unknown tenant slug or an id neither namespace recognises; 502 a recognised id whose clear failed. |

Authorization on both routes is the signed `x-portal-m2m` header (`requireServiceBinding` verifies the HMAC; `server/lib/m2m-auth.ts`). Both answer 404 on a deployment without the platform API (see above). The migration route answers 409 when pinning is off, and restore and purge answer 503 when the collaborative-document namespaces are not bound.

## What the server checks (lineage guard)

Every object keeps a generation id. A browser that holds a recorded id reports it on the socket upgrade as `?gen=<id>`. If it differs from the object's id, the object sends the generation frame only and closes the socket with code 4410, so that socket cannot write; the client then discards its local copy (keeping one backup on the device) and reconnects with the new id. A client that sends no `gen` is served as before: a cached old bundle is protected only by the generation frame it may ignore, until the page is reloaded and the new bundle is fetched. Protocol, backup slot and residual window are described in `docs/concepts/collab-editing.md` ("Lineage guard"); they are not repeated here.

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
A Cloudflare id cannot be turned back into the name it came from, so ownership is checked by the object itself: the route
sends the tenant's id with the purge, and the object compares it with the tenant identity it stored when the document was
first stored its identity. A different tenant, or a document with no stored identity (it cannot be attributed), is refused with a 403 and
nothing is deleted; an object that holds no document is simply emptied.

## Copying existing documents

Until a document is copied, its editing history and restore points live in the old object, and the new object holds only
what the database has (the current values). Copy once per deployment, right after turning pinning on and before anyone edits (see "Switching it on: the order").

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
documented in `server/lib/m2m-auth.ts`). A standalone (non-saas) deployment has no HTTP trigger for it and the route answers 404; the same functions
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

**Clients and the lineage guard.** A document built from the database and the old document are two independent histories. A
browser that connected to the pinned target before `replaceDerived` holds the target's history, and merging it into the
old one would not combine them (per finding, one history wins by client id). Each object therefore carries a generation id
(`docs/concepts/collab-editing.md`, "Lineage guard"): the replacement keeps the SOURCE's id, so browsers holding the old
document stay valid, and a browser that synced with the displaced target holds a different id and discards its local copy
on its next connect (keeping one backup of it on that device). A backup restore puts the displaced document's id back.
Limits: a browser whose store was written before the guard shipped recorded no id and is trusted once, so after the first
deploy ask anyone who may have opened these reports on the pinned target to reopen them online, or confirm nobody did,
before running `replaceDerived`. An export from an older object carries no id and gets a new one on import. If you roll the
engine back to a build without the guard, a `replaceDerived`, backup restore or version restore done in that window is
invisible to it (no new id is minted), so browsers holding the displaced history are not discarded after you roll forward.

**Timing.** An old object whose save alarm was armed before the deploy still runs it, and that save writes the old document's
projection to the database. This is harmless to the check, because the two then agree; but an alarm that fires between the
check's database read and the import would leave the copy one save behind. Wait a minute after deploying before the real
pass (the save alarm fires about one second after the last edit; a minute leaves room for retries).

Until `conflicts`, `skipped` and `failed` are empty or resolved, the old objects are the only copy of those documents'
history, so leave them be. Deletes keep reaching them through the old namespace either way.

### Local development cannot pin a jurisdiction

Jurisdiction pinning only works on a real Cloudflare deployment. The local runtime that `wrangler dev` starts (workerd) does not implement it: with `DO_JURISDICTION` set to a jurisdiction such as `us`, every request that reaches a pinned Durable Object fails with a 500 and the message "Jurisdiction restrictions are not implemented in workerd". With the variable unset, the migration route answers 409 because there is nothing to pin to.

Consequences for an operator:

- Leave `DO_JURISDICTION` unset in local development and in `.dev.vars`. Setting it locally breaks the app rather than simulating the pin.
- A migration dry run cannot be rehearsed locally. Run it against a real deployment (a staging Worker or a preview deployment on your own Cloudflare account) and confirm the result there before touching production.
- Tests that need the pinned behavior must stub the namespace; they cannot rely on the local runtime to enforce it.

## Known limits

- **Old objects keep their content.** The copy never changes or deletes the old (unpinned) object. After migration it still holds the document, and the personal data in it, until its inspection is deleted. Nothing else cleans it. If your retention or data-residency obligations require the old copies to be gone, plan for it: after the copy is verified, delete the inspections you no longer need (a delete clears both namespaces), or purge the old objects one at a time with the single-object purge using ids from your logs. Record that you did so.
- **Deleting an inspection** clears both the pinned and the unpinned namespace for the report ids it owns, best effort (see "Deleting").
- **Changing `DO_JURISDICTION` later orphans every pinned object.** The same name yields a different id in a different jurisdiction (and in none). Do not change the value after objects exist; moving to another value needs the same copy procedure from scratch, and the tooling copies from the unpinned namespace only. The worker cannot warn you: it keeps no record of the value it ran with before, and adding such a record would be extra state to maintain. An accidental change therefore shows up only as documents that open empty and rebuild from the database. Keep the value in version control and review any change to it as a data move.
- **Standalone deployments have no platform routes.** Both answer 404 outside the SaaS profile; run the migration functions from a maintenance script (see "Copying existing documents"). The single-object purge route is likewise unavailable there.
- **Orphans whose report row is gone** (for example a delete that failed, or inspections deleted before the purge existed) cannot be found by name. They are removable only by Cloudflare object id, taken from your logs, through the single-object purge route. That route refuses an object that belongs to another tenant (403). It also refuses an old object that holds a document but never stored an identity, so such an object cannot be removed through it.
- **The copy reads each document from the database whole.** A batch of up to ten documents is read in one query, and each document's stored results are loaded in full. A row too large for the database to return makes that query fail; the batch then falls back to one query per row, and a row that still cannot be read is reported as `database-row-unreadable`. Nothing is written for it, and the rest of the batch carries on. Use a small `limit` if your reports are large.
- **A displaced document has one backup slot.** A replacement stores the document it displaced under a single key. A second replacement of the same object is refused (`target-edited`), because the first one cleared the database-built marker, and a restore spends the backup. A backup is lost only by an operator action: a restore spends it, a purge or an inspection delete removes it with the object, and editing the stored values by hand loses it silently.
- **The MCP namespace is bound but unused.** `INSPECTOR_MCP` is still listed among the pinned namespaces. The MCP endpoint is now a stateless handler (`createMcpHandler`, `server/lib/mcp/handler.ts`), no code in `server/` or `workers/` addresses `INSPECTOR_MCP`, and the retained class answers 410 to anything. So no MCP session data is stored in it. This was checked by reading the source and configuration; it was not tested against a deployed jurisdiction.

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
