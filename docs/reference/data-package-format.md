# Tenant data-package format (v1)

A data package is a directory of zip volumes that a desktop app writes locally
when a company exports all of its data. The server never assembles or reads it:
it exposes a small read API, and the client groups, hashes, compresses and
verifies the bytes. This document describes the on-disk format so the offline
verifier and an importer can be written against one contract.

The format schema lives in [`packages/data-package`](../../packages/data-package/index.ts)
and is published as `@inspectorhub/data-package`. The Zod schemas there are the
authority: this page is prose, and if it ever disagrees with the code, the code
wins.

## Layout

```
<package>/
  manifest.json          canonical manifest (pretty JSON + trailing newline)
  checksums.sha256       one `sha256  path` line per root-volume file + the media index
  package.zip            root volume: listed files, media index, manifest, checksums
  media-001.zip          stored (uncompressed) media objects
  media-002.zip          ...
```

- `manifest.json` is byte-for-byte what `serializeManifest` writes. `parseManifest`
  refuses a file that is not in canonical form, so an editor that reformats it
  breaks the package.
- The root volume holds every data file, the e-sign event stream, the media
  index, and copies of `manifest.json` and `checksums.sha256`.
- Media objects are **not** in `manifest.files`. They are described row by row
  in `media/index.ndjson`, which keeps the manifest small however many photos a
  company has.
- Media volumes are STORED, not deflated: photos and videos are already
  compressed, and a volume's byte total in the manifest is its real zip size.

## Manifest fields

| Field | Meaning |
|---|---|
| `formatVersion` | `1` (also the maximum this reader accepts). |
| `schemaVersion` | Name of the last D1 migration applied at export time. |
| `columnFingerprint` | Fingerprint of the exported column set. |
| `engineVersion`, `packageId`, `exportedAt`, `sourceMode`, `sourceTenantId`, `sourceHost` | Producer identity. `sourceHost` is `null` for standalone deployments. |
| `encryption` | Always `null` in v1. The format defines no encrypted layout. |
| `counts` | Per-table row totals; each must equal the sum of that table's NDJSON shards. |
| `media` | Object count and the index file's path, byte length and SHA-256. |
| `files` | Root-volume files: path, volume (always `package.zip`), optional `rows`, `bytes`, SHA-256. |
| `volumes` | Media volumes: name, byte length, entry count, SHA-256. Numbered consecutively from `media-001.zip`. |
| `excluded` | Rows/columns/objects left out of the package and why (see below). |

Every manifest object is strict: an unknown key is refused. Text that came from
the source deployment (`excluded[].reason`, ids) is untrusted and must be
escaped wherever it is displayed.

## Files and shards

- Data rows live in `data/<table>.ndjson`, `data/<table>.2.ndjson`, ... with
  shard numbers consecutive from 1. `esign/` holds the e-sign event stream.
- Each line is one JSON object. Lines are UTF-8, no BOM, no blank lines, and
  must survive `parseJsonStrict` (no unpaired surrogates, bounded depth).
- `rows` on a file must equal the number of lines when read with `readNdjson`;
  `bytes` must equal the file's real byte length.
- `checksums.sha256` lists exactly `manifest.files` plus `media/index.ndjson` —
  no extra lines, no missing lines, no different digests. Media volumes carry
  no checksums file; a volume may hold more entries than a checksums file can.

## Media index

`media/index.ndjson` has one row per object:

| Field | Meaning |
|---|---|
| `key` | Original R2 object key (relative to the tenant prefix). |
| `entry` | Safe zip entry name inside a media volume. |
| `bytes`, `sha256` | Object size and digest — the per-object integrity check. |
| `volume` | Which `media-XXX.zip` holds it. |
| `content_type` | Stored MIME type. |
| `referenced_by` | Table/id pairs from the exported rows (informational). |

`verifyMediaIndex` checks the index file's bytes and digest, its row count,
that each volume's row count equals `manifest.volumes[].entries`, and that the
bytes of a volume's objects fit in its declared size. The verifier then opens
each volume and checks every object's own digest against its index row.

Entry names follow a strict ASCII allowlist with case-folded uniqueness and no
directory/file collisions. Keys that cannot pass are renamed deterministically
into `media/_mapped/<hash>/<leaf>` rather than rejected.

## Limits (v1)

- ZIP64 is out of scope. A volume stays under the classic zip limits:
  65,000 entries and 4 GiB minus a margin. The desktop client caps a volume at
  1 GiB, well under that.
- The root volume's listed files plus the media index plus the two metadata
  files must also stay within those limits.
- An object larger than one volume's budget gets a volume of its own; if it
  alone exceeds the maximum it is recorded in `excluded` and reported to the
  user at completion.

## Excluded data

`excluded[]` records anything that did not travel: withheld secret columns,
out-of-scope tables, unclassified columns, externally hosted media (streamed
video whose bytes are not in the package), and mode-bound content. Each entry
carries a class, the table, optional columns/ids, and a human-readable reason.
The completion screen lists these so the owner can confirm the export is
complete for their purpose.

## Plaintext

A v1 package is **plaintext**. It contains personal data, signed agreements
and financial records, and is the only surviving copy after a purge. Store it
on an encrypted disk and keep it offline. There is no passphrase option: the
`encryption` field is reserved but unused. Temporary `.part` files are deleted
when a volume closes; on an SSD this does not guarantee secure erasure.
