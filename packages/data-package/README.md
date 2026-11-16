# @inspectorhub/data-package

The tenant data package format for OpenInspection: safe-JSON, NDJSON, checksums,
shard and volume naming, and a streaming media index. The format is shared by
the desktop client, which assembles and verifies a package, and the engine,
which serves paged reads and accepts write batches.

The library is pure data and logic. It imports only `zod` and its own modules —
no `server/`, no `app/`, no Cloudflare or Node APIs. A caller supplies the
transport (paged reads, R2 byte streams, writes) itself.

The published name is `@inspectorhub/data-package`.

## What is in the box

- `safe-json` / `ndjson` — strict JSON values and a bounded NDJSON encoder/reader.
- `checksums` / `sha256-js` — the GNU-sha256sum-style checksum file and SHA-256
  hashing (native `DigestStream` when present, a pure-JS fallback otherwise).
- `manifest` / `fingerprint` — the package manifest and a table-column-set
  fingerprint.
- `shard` / `volume` — data-file naming, shard cutting and (split-ZIP) volume
  planning. Packages use split ZIP volumes, never ZIP64.
- `entry-name` / `media-key` — hostile-name validation and R2-key to entry-name
  mapping.
- `media-index` — a streamed, bounded `media/index.ndjson` writer and verifier.
- `errors` — the format error type and codes.

## License

AGPL-3.0-only.
