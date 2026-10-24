# @inspectorhub/field-ui

The OpenInspection field inspection editor as an embeddable React package, so
the web app and other hosts (for example the offline-first native client) can
share one editor.

**Status: pre-1.0 and incomplete.** The package is being extracted from the
OpenInspection web app in steps. What the published build exports today is the
host contract (the data source, its types, the provider and hooks, locale
binding) and an in-memory fake for tests. The editor components themselves are
not exported yet; this README says so again where it matters, and will change
when they land.

## What the build exports

Built with `npm run build -w @inspectorhub/field-ui` (ESM only, React and Yjs
external):

| Entry | Contents |
|---|---|
| `@inspectorhub/field-ui` | `FieldDataSourceProvider`, `useFieldDataSource`, `useFieldCommand`, `useFieldEnsureHuman`, `useFieldSlots`, `isIgnored`, `setFieldLocale`, `bindFieldLocaleSource`, and the TypeScript types of the contract |
| `@inspectorhub/field-ui/testing` | `createFakeDataSource` and fakes for each optional resource, for host test suites |
| `@inspectorhub/field-ui/theme.css` | The design-token and base-layer CSS (see Theme) |

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
- `urls`: `FieldUrls`, the address builders for photos, reports, presence and
  in-app paths.
- `resources`: `FieldResources`, optional capabilities (preferences, canned
  comments, cost items, repair items, media pool, settings sheet, AI assist,
  publish readiness, template search, version history, video). A member the
  host leaves out hides its entry point.
- `platform`: `'web' | 'ios' | 'android'`.

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
copied into `dist`. The current build does not import any of them yet (the
editor components are not exported), so nothing is required today. Once the
editor components ship, the host must import, from its own copy of each
library:

```ts
import 'yet-another-react-lightbox/styles.css';
import 'react-photo-album/rows.css';
```

## Peer dependencies

Declared in `package.json` and resolved by the host so there is one copy of
each: `react` and `react-dom` ^19, `yjs`, `lib0`, `y-indexeddb`, `y-protocols`,
`konva`, `react-konva`, `react-easy-crop`, `react-photo-album`, `sortablejs`,
`yet-another-react-lightbox`. Today only `react` and `yjs` (in
`/testing`) are imported by the build; the rest are declared ahead of the
editor components.

## Licence

Licensed under the GNU Affero General Public License v3 (AGPL-3.0-only). See LICENSE.
