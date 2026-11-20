# Spike: preserving ids on import into an empty single-tenant target

> This spike's throwaway probe (a Yjs encode/decode script) was never committed —
> its result is recorded here so the verdict is reproducible without leaving a
> dead script in the tree.

**Verdict: GO — keep-ids is safe for an empty target whose configured single-tenant
id equals the package's source tenant id.** In that mode ids, R2 keys and Durable
Object names are unchanged, so the binary `ydoc_state`, the `data` JSON and the
signed report snapshots need no rewriting and their hashes stay valid. When the
precondition does not hold, the importer must use the id-rewrite path instead.

## Question

A package's inspection ids, tenant id, R2 media keys (`<tenant>/inspections/<id>/...`)
and Durable Object names (`<tenant>:<id>`) are embedded in three places that would
have to change if ids were reminted on import:

1. `inspection_results.data` (JSON) — finding photo entries carry full R2 keys;
2. `inspection_results.ydoc_state` — the binary Yjs state holds those same photo keys;
3. `report_versions.snapshotJson` — published, hashed (`contentHash = sha256(snapshotJson)`)
   and Ed25519-signed over the hash.

If import remints ids (the generic "fresh UUID" path), all three must be rewritten,
and rewriting a signed snapshot invalidates its signature. Can an empty target
avoid this by keeping the source ids?

## Evidence

1. **Photo keys inside the Yjs binary carry the ids.** A probe built a real Yjs
   results doc with one finding whose photo key was
   `tenant-src/inspections/insp-src/photos/m-abc.jpg`, encoded it with
   `Y.encodeStateAsUpdate`, and searched the bytes: the tenant id, inspection id
   and full key all appear **verbatim** in `ydoc_state`; decoding round-trips the
   key unchanged. In a remint-to-`tenant-dst`/`insp-dst` world that key must become
   `tenant-dst/inspections/insp-dst/photos/m-abc.jpg` — i.e. the binary must be
   rewritten.
2. **The DO and R2 key derivation embed the ids.** `r2-keys.ts` builds photo and
   document keys from `(tenantId, inspectionId, …)`; the results Durable Object is
   addressed by `${tenantId}:${inspectionId}` and receives its identity from request
   headers. Keeping the ids keeps every derived name stable.
3. **Signed snapshot hashes depend on the ids and keys.** `report-version.service.ts`
   builds the snapshot from `inspection`, `data` (with photo keys), `units`,
   `inspectors` and commercial parts, hashes it, and signs the hash. Verification
   recomputes `sha256(snapshotJson)` and compares to `contentHash`. Any id/key
   substitution breaks both the hash and the signature. Keeping ids byte-for-byte
   preserves both.

## Scope and precondition

Keep-ids applies only when the target is empty (starter content only) **and** its
configured single-tenant id equals the package's `sourceTenantId`. Under that
condition:

- inspection ids, photo/document keys and DO names are copied unchanged;
- `data` and `ydoc_state` are copied unchanged (no rewrite of JSON or binary);
- `report_versions` snapshots, `contentHash` and signatures stay valid;
- users are still mapped to the target's owner account created at setup — their
  ids are NOT import identities.

If the precondition fails (non-empty target, or a different configured id), the
importer must take the id-rewrite path: mint new ids, remap photo keys, rewrite
`data`, rebuild `ydoc_state`, and re-sign report snapshots (the published chain
cannot be preserved byte-for-byte; the importer reports what was re-signed).
That path is materially larger and is a separate decision.

## Consequence for the importer

Prefer keep-ids for the empty-target case and assert the precondition before
taking it. Treat the id-rewrite path as required for every other case. Tests must
cover: photo key unchanged in both `data` and decoded `ydoc_state`; snapshot hash
and signature still verifying after import when ids are kept; and the rewrite
path being used (and reported) when the precondition does not hold.
