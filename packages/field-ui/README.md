# @inspectorhub/field-ui

The OpenInspection field inspection editor as an embeddable React package, so
the web app and other hosts (for example the offline-first native client) can
share one editor.

**Status: pre-1.0.** The editor page component (`FieldEditor`) is exported,
together with the host contract it runs on. While the version is below 1.0 a
minor release can change the exported surface; pin a minor range such as
`~0.3.0` until 1.0.

## What the build exports

Built with `npm run build -w @inspectorhub/field-ui` (ESM only, React and Yjs
external):

| Entry | Contents |
|---|---|
| `@inspectorhub/field-ui` | The editor and the host contract, listed below |
| `@inspectorhub/field-ui/testing` | `createFakeDataSource` and fakes for each optional resource, for host test suites |
| `@inspectorhub/field-ui/theme.css` | The design-token and base-layer CSS (see Theme) |

The root entry exports:

| Group | Exports |
|---|---|
| The editor | `FieldEditor` (props: `{ data: EditorData; readOnly?: boolean }`) |
| Host contract | `FieldDataSourceProvider`, `useFieldDataSource`, `useFieldCommand`, `useFieldEnsureHuman`, `useFieldSlots`, `isIgnored`, `setFieldLocale`, `bindFieldLocaleSource`, and the TypeScript types of the contract (`FieldDataSource`, `FieldHostSlots`, `FieldUrls`, `FieldResources`, `EditorData`, `SessionInfo`, and so on) |
| Finding keys | `findingKey`, `findingsForUnit`, `isMetaKey` (the same functions the server uses to address a result) |
| Photo decoding | `DecodeImageError`, `isDecodeImageError` (matches by error name, so it works across two copies of the package), and the types `DecodeImage`, `DecodeImageOptions`, `DecodedImage` (see `media` below) |
| Results document | `appendPendingPhoto` (adds a pending photo entry for a file the host stored on the device; needs the finding key and a pending id; adding the same pending id twice leaves one entry), `resolvePendingPhoto` (swaps a pending offline photo entry in the results document for its uploaded key; needs the finding key) |
| Commercial report text | `resolvePcaNarrative`, `RELIANCE_TEMPLATES`, `METADATA_PRESETS` |
| Preferences | `DEFAULT_INSPECTION_PREFS` |
| Overlay stack | `hasOpenLayer`, `escapeWillBeHandled` (see "Back key and open dialogs") |
| Types | `GalleryPhoto`, `CoverPhotoOption`, `ReportProfileOption`, `VideoUploadRef`, `PublishReadiness`, `PublishBlockingDefect` |

## Mounting the editor

```tsx
import { FieldDataSourceProvider, FieldEditor, setFieldLocale } from '@inspectorhub/field-ui';

setFieldLocale(session.locale); // and keep it in step with the host's own locale

<FieldDataSourceProvider dataSource={myDataSource} slots={mySlots}>
  <FieldEditor data={editorData} />
</FieldDataSourceProvider>
```

Pass `readOnly` to show an inspection for reading only. Nothing in a read-only editor can write: the results document is
never handed to a write helper, every write on the data source (commands, uploads, the media store, the resource writes)
is refused with "This inspection is read-only.", and the controls that write (rating row, notes input, add-photo tile,
publish, sign, finish, structure and template editing, settings, units, cost items, batch and Speed mode) are not
rendered. Navigation, the section and item lists, the rating as an indicator, notes as text, photos and their viewer, the
preview and updates from other people keep working. Without `readOnly` nothing changes.

What the host has to provide:

- A `FieldDataSource` (next section). `editorData` is what its `load()` returns.
  It must follow the host's revalidation: units, publish state and the rest are
  read from it on every render, so pass the fresh value after each reload.
- `slots` (`FieldHostSlots`). Publishing is guarded by a human check that fails
  closed: a host that provides neither `slots.ensureHuman` nor
  `slots.humanCheck: 'not-required'` gets a check that refuses every send. A
  host that has no such check by design must write `humanCheck: 'not-required'`
  down explicitly; leaving the slot out does not turn the gate off.
- `slots.renderUnsavedGuard`, if leaving the editor with unsaved work should be
  intercepted. Absent means leaving is never intercepted.
- The theme (see Theme) and the peer dependencies (see below).

A member of `urls`, `resources` or `slots` that the host leaves out hides the
entry point that needs it. In particular `urls.costExport` is optional: a host
without a cost download omits it and the Cost Items panel shows no export
links.

### Back key and open dialogs

The editor opens dialogs and drawers on an overlay stack that lives inside this
package (it is bundled, so a host cannot read it from anywhere else). A host
that handles a hardware back key or a back gesture asks this copy first:

```ts
import { escapeWillBeHandled, hasOpenLayer } from '@inspectorhub/field-ui';

if (hasOpenLayer()) {
  // an editor dialog is open: let it consume the key instead of leaving the page
}
```

`hasOpenLayer()` is true while any layer is open (dialog, drawer, popover or
menu). `escapeWillBeHandled()` is true when the next Escape will be taken by an
overlay.

### Server rendering

The editor is built for a client that renders it. A host that renders on a
server must give `react-konva` a server stub of its own: the photo annotator
only renders in the browser.

## The data source contract

The editor never talks to a server itself. A host implements `FieldDataSource`
and passes it to `FieldDataSourceProvider`:

```tsx
import { FieldDataSourceProvider } from '@inspectorhub/field-ui';

<FieldDataSourceProvider dataSource={myDataSource} slots={mySlots}>
  {/* editor */}
</FieldDataSourceProvider>
```

`FieldDataSource` (see `FieldDataSource` in the published `.d.ts` for the exact
signatures):

- `load(inspectionId, scope?)` returns the `EditorData` the editor opens with
  (inspection, template schema, results, rating levels, tag library, units,
  and so on).
- `session()` returns `SessionInfo`: the viewer's id (null when the host cannot tell; the editor then announces no presence), role, locale, time zone,
  date and clock formats, and the video backend.
- `execute(inspectionId, command, { idempotencyKey })` runs one typed
  `FieldCommand` and answers a `CommandResult`.
- `notify`, `reload`, `exit`, plus optional `restartSession` and `openUrl`.
- `isOnline()` and `onOnlineChange(cb)`.
- `collab`: a `CollabConnector` that opens the results Yjs document for an
  inspection (local persistence first, then network).
- `media`: a `PendingMediaStore` and a `uploader(inspectionId, doc)` factory.
  Optional `decodeImage(file, opts)` is the host's decoder for a file the browser cannot decode (HEIC/HEIF):
  - It returns `{ blob }`, an upright JPEG, or `null` to decline (the file is then handled as before).
  - For a file it recognises but cannot decode it rejects with `DecodeImageError(code, message)`. The `message` is
    shown to the person and only that file is skipped; the rest of the batch continues. Test for it with
    `isDecodeImageError(err)` (by `err.name`), not `instanceof`, if the host may hold a second copy of the package.
  - With keep original on, a HEIC is still converted: `opts.keepOriginal.maxBytes` (10 MiB) asks for full size at the
    best JPEG quality that fits. Otherwise `opts.maxLongEdge` bounds the size.
  - Absent, photos behave exactly as in 0.2.1.

  A failed `MediaUploader` result may carry `kept: true`: the host stored the bytes on the device and wrote the
  pending entry itself with the exported `appendPendingPhoto(doc, findingKey, pendingId)`. The editor then shows a
  neutral notice and counts the batch as saved, not failed.
- `urls`: `FieldUrls`, the address builders for photos, reports, presence and
  in-app paths.
  `photo()` is synchronous; a host that can only produce an address later (a photo it fetches and caches) provides the
  optional `subscribe(listener)` and calls the listener whenever any photo address may have changed. The editor then asks
  `photo()` again and its thumbnails, viewer and previews show the new address. Calls may be batched; `subscribe` returns
  the unsubscribe function. Absent, nothing changes.
- `resources`: `FieldResources`, optional capabilities (preferences, canned
  comments, cost items, repair items, media pool, settings sheet, AI assist,
  publish readiness, template search, version history, video). A member the
  host leaves out hides its entry point.
- `platform`: `'web' | 'ios' | 'android'`.

The `compliance` signoff command's `personId` and `name` are optional (sent together). Absent means the signed-in
user; the panel shows the two inputs only to an owner or manager, empty.

`FieldHostSlots` carries host-owned UI (theme switch, PDF export, human
verification). An absent slot hides its entry point.

A host that can render on a server may remember which layout band (`phone`,
`tablet`, `desktop`) a device showed last time, so the server render matches the
client's first render instead of always assuming `desktop`. It receives the band
through the optional `FieldHostSlots.onLayoutObserved(layout)` (called after mount
and when the band changes), stores it however it likes, and returns it as the
optional `EditorData.initialLayout` on the next load. The real viewport still
decides right after mount, so a wrong memory is corrected. The package never
stores the value itself.

Use `@inspectorhub/field-ui/testing` for a ready-made in-memory implementation.

## Theme

The package ships its design tokens as plain CSS that your Tailwind v4 build
compiles (it contains `@theme` blocks), so it is a file rather than bundled
output. In your global stylesheet:

```css
@import "tailwindcss";
@import "@inspectorhub/field-ui/theme.css";

/* Scan the package so Tailwind generates the utilities it uses. Adjust the
   relative path from your stylesheet to node_modules. */
@source "../node_modules/@inspectorhub/field-ui/dist";
```

## Third-party stylesheets

The editor's photo gallery and lightbox use `react-photo-album` and
`yet-another-react-lightbox`. Those libraries are peers and their CSS is not
copied into `dist`. Instead `dist/index.js` keeps two bare side-effect imports,
`import "react-photo-album/rows.css"` and
`import "yet-another-react-lightbox/styles.css"`, which your bundler resolves
from its own copy of each library. The bundler therefore has to handle `.css`
imports from `node_modules` (Vite and webpack with a CSS loader do). If yours
does not, import the two files yourself from your global stylesheet entry.

## Peer dependencies

Declared in `package.json` and resolved by the host so there is one copy of
each: `react` and `react-dom` ^19, `yjs`, `lib0`, `y-protocols`, `konva`,
`react-konva`, `react-easy-crop`, `react-photo-album`, `sortablejs`,
`yet-another-react-lightbox`. `y-indexeddb` is also declared, but as an
optional peer: this package never imports it, and only a host that persists the
results document in the browser through its own `CollabConnector` needs it.

The built root entry imports `react`, `react-dom`, `yjs`, `react-konva` (which
needs `konva`), `react-easy-crop`, `react-photo-album`, `sortablejs` and
`yet-another-react-lightbox`, so a host that mounts `FieldEditor` installs all
of those. `lib0` and `y-protocols` are declared as peers but the built root
entry does not import them today; they matter to a host that writes its own
`CollabConnector` on the Yjs sync protocol.

## Licence

Licensed under the GNU Affero General Public License v3 (AGPL-3.0-only). See LICENSE.
