# @inspectorhub/offline-package

The OpenInspection offline data package format as a small, dependency-light
TypeScript library. A package is a zip archive that a field device exports and
a server imports: it carries the inspections worked on offline, the writes that
were queued while offline, and the photos taken. This library reads the archive,
cuts it into parts a server will accept, and drives the import to a result.

The same code runs in the OpenInspection server, in its web importer, and in
native clients, so all of them agree on the format and on what an import
promises.

It is pure logic: no network, no storage, no DOM, no Node-only APIs. The caller
supplies the transport.

## Install

```bash
npm install @inspectorhub/offline-package fflate zod
```

`fflate` and `zod` are peer dependencies, so your application keeps one copy of
each. ESM only.

## What it exports

| Export | What it is |
|---|---|
| `readPackageSummary(zip)` | Reads the manifest and counts without unpacking the entries. Use it for a preview before the user confirms. |
| `parsePackage(zip, options?)` | Unpacks and validates a whole package in memory. Throws `PackageFormatError` for a malformed archive. |
| `planParts(zip, limits)` / `splitPackage(zip, ids)` | Cut a package into parts that each stay inside a server's limits. |
| `extractHeldBackPackage(zip, ids)` | Builds a valid package that holds only the named inspections, so what an import could not place can be saved and retried. |
| `runImport(zip, send, options?)` | Sends the package through your `send` function, reads each answer, splits and resends until every inspection is either imported or held back with a reason. Returns an `ImportReport`. |
| `classifyResponse(result, expected?)` | Maps one server answer to what the import should do next. |
| `DEFAULT_IMPORT_LIMITS`, `IMPORT_LIMIT_CEILINGS` | The size limits the format assumes by default and the most an operator can raise them to. |
| `OfflinePackageManifestSchema`, `OutboxSchema`, `MediaIndexSchema`, ... | The zod schemas of the manifest, the queued writes and the media index, with the retention constants. |

The TypeScript types of all of the above are exported as well (`ImportReport`,
`HeldBack`, `Send`, `SendResult`, `PackageSummary`, and so on).

## Importing a package

You provide `send`: one function that posts a package (or a part of one) to the
server and reports the answer. It must report a refusal as a result and throw
only when no answer was received at all.

```ts
import { readPackageSummary, runImport, type Send } from '@inspectorhub/offline-package';

const send: Send = async (bytes) => {
  const res = await fetch('/api/offline-import', {
    method: 'POST',
    headers: { 'content-type': 'application/zip' },
    body: bytes,
  });
  // The parsed JSON body is enough: the error code and details are read from `body.error`.
  const body: unknown = await res.json().catch(() => undefined);
  return { status: res.status, body };
};

const summary = readPackageSummary(zipBytes); // preview: counts, who exported it, when
const report = await runImport(zipBytes, send, {
  onProgress: ({ settled, imported, heldBack, pending }) => console.log(settled, imported, heldBack, pending),
});

report.imported; // inspection ids the server confirmed
report.heldBack; // { id, reason, ... } for each one that was not imported
```

The guarantees `runImport` keeps:

- Every inspection in the input ends up in `imported` or in `heldBack`, never in
  both and never in neither.
- Requests are strictly serial, and a part the server confirmed is never sent
  again.
- Retries are bounded by an attempt count and a time window per part.
- A refusal of the whole package stops the run; the parts not yet sent are held
  back with the same reason instead of being dropped.
- Whatever a callback or the cutting code throws, what was imported stays
  imported and the rest is held back.

`send` owns its own timeout and cancellation. `runImport` waits for the promise
and never aborts it, so a transport that can hang forever hangs the import; a
request abandoned by a timeout should reject, and it will be sent again.

## Compatibility

The format is versioned by its manifest. This package is pre-1.0: a minor
version can change the exported surface, so pin a minor range such as `~0.1.0`
until 1.0.

## Licence

AGPL-3.0-only. See `LICENSE`.
