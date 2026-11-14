# Dependency alerts that cannot be fixed within declared ranges

Dependabot opens an alert when a package in `package-lock.json` falls in an advisory's range. Most are closed by a
normal upgrade. Some cannot be, because the package that holds the old copy declares a range that does not admit the
patched release. This page says how those are handled and records the ones that needed a scoped override.

The minimatch alert (GHSA-g3hv-75wg-m249) is closed. The section below records how, and which copies still need watching.

## How an alert is handled

1. Find which packages hold the affected copy: `npm ls <package>`, and `npm audit --registry=https://registry.npmjs.org`
   (the default registry in some environments is a mirror that does not implement audit).
2. Try the ordinary fix: upgrade the holder. If the holder's latest release admits the patched version, that is the end of it.
3. If it does not, split the holders by where they run:
   - **Installed with the production dependencies** (reported by `npm audit --omit=dev` and flagged as runtime scope by
     Dependabot, whether or not the Worker bundle contains it): move that chain to the patched line with an npm `overrides`
     entry scoped to the packages in that chain, and prove the consumers still work (a real round trip, not only an install).
   - **Development tooling only** (lint, type-check, tests): first try upgrading the holder to a release whose declared
     range admits the patched version. If no such release exists, a package-scoped override can move that one holder,
     provided every consumer is checked. A copy outside the advisory's affected range needs no change.
4. Never apply an override across the whole tree to close an alert without running every consumer. A global override
   once passed an install and a lockfile check and still made the linter fail at start-up (see the entry below).
5. An alert that cannot be closed yet stays open and is tracked here; record the reason and the exit condition.

## Resolved: minimatch, GHSA-g3hv-75wg-m249 (CVE-2026-118764), alert 72

- **Advisory:** `minimatch` `>= 7.0.0, < 11.0.1` (potential denial of service in glob-part expansion); first patched
  release 11.0.1.
- **Status:** closed. The affected copy was minimatch 10.2.4, held by the lint toolchain. `eslint`,
  `@eslint/config-array` and `eslint-plugin-import-x` were upgraded to releases whose declared ranges admit minimatch
  11, and one package-scoped override moves `@typescript-eslint/typescript-estree` to the patched line. `npm ls minimatch`
  then shows no copy in the affected range. minimatch 3.1.5, held by `eslint-plugin-react` and
  `eslint-plugin-jsx-a11y`, is below the advisory's lower bound and does not hold the alert open.

### Fixed: the exceljs chain (production dependencies)

`exceljs` is installed with the production dependencies and pulls minimatch through `archiver` (`archiver-utils`,
`readdir-glob`) and through `unzipper` (`fstream`, `rimraf`, `glob`). Server code does not import it: the product serves the
prebuilt browser bundle (the package's `dist/exceljs.min.js`, copied by `scripts/vendor-copy.js`), and only specs load the Node
build. So `archiver`, `unzipper` and `glob` are not part of the Worker bundle; they are reported because they are installed
with the production dependencies. Those copies are now on the patched line, using `overrides` in `package.json`:

| Override | Effect |
|---|---|
| `"archiver-utils": { "glob": "^14.0.3" }` | `archiver-utils` uses `glob` 14, which uses minimatch 11 |
| `"readdir-glob": { "minimatch": "^11.0.1" }` | `readdir-glob` uses minimatch 11 |
| `"unzipper": "^0.12.5"` | `unzipper` 0.12 no longer depends on `fstream`, `rimraf` or `glob`, which removes the last `glob` 7 copy |

These are keyed by package name rather than nested under `exceljs`: a nested form for the direct `archiver-utils` child was
tried and npm did not apply it. The three packages are used only by the exceljs chain, so the scope is the same.
`npm audit --omit=dev --registry=https://registry.npmjs.org` reports `found 0 vulnerabilities` after the change.

Backed by specs: `tests/unit/tooling/exceljs-chain.spec.ts` writes a workbook with the stream writer (archiver), reads it
back with the stream reader (unzipper) and the buffered reader, and builds a zip from a glob and a directory;
`tests/unit/tooling/minimatch-upstream-watch.spec.ts` pins the lockfile outcome (glob 14, minimatch 11.0.1 or later under
`readdir-glob`, `unzipper` 0.12.5 or later, no `fstream` or `rimraf`). The xlsx specs (`xlsx-import`, `xlsx-loader`,
`StartImportPanel`) cover the browser-bundle path.

### Fixed: the lint toolchain (development scope)

| Holder | Change |
|---|---|
| `eslint` 10.15.0, `@eslint/config-array` 0.23.6 | declare `^11.0.5` themselves |
| `eslint-plugin-import-x` 4.18.1 | declares a range that admits 11 and no longer imports `makeRe` |
| `@typescript-eslint/typescript-estree` 8.72.2 | still declares `^10.2.2`; moved with a package-scoped override |

The override is keyed to that single package: `"@typescript-eslint/typescript-estree": { "minimatch": "^11.0.1" }`.
Its call site passes a filename and a pattern from the lint configuration through the callable export, and no
configuration in this repository enables `projectService` / `allowDefaultProject`, so that path is not reached.
`npx eslint --print-config` loads every plugin after the change.

| Copy still present | Held by | Why it stays |
|---|---|---|
| minimatch 3.1.5 | `eslint-plugin-react`, `eslint-plugin-jsx-a11y` | below the advisory's `>= 7.0.0` lower bound; these plugins call the legacy callable API that minimatch 11 removed |

All of these run only when someone lints, on patterns that come from this repository's own configuration, never from input
supplied by a user of the product, and none is part of the Worker bundle.

### Why there is no global override

minimatch 11 exports no callable default and no `makeRe`. `eslint-plugin-react` calls it as a function in five rules
(`no-unstable-nested-components` among them) and `eslint-plugin-jsx-a11y` does in `label-has-associated-control`; both
throw. `eslint-plugin-import-x` imported `makeRe` by name in the release this repository used to install, which stopped
the plugin loading at all. A patch of the installed plugin was tried and removed: it only hid the failure for one rule
and gave false assurance about the rest.

That is why the fix uses a package-scoped override instead of a global one: the 3.1.5 copies keep the API their
consumers expect, while the holders that can use minimatch 11 are moved onto it.

### Re-evaluation

- **Condition:** `@typescript-eslint/typescript-estree` publishes a release whose declared range admits minimatch 11.0.1
  or later. Delete its package-scoped override then. `eslint-plugin-react` and `eslint-plugin-jsx-a11y` are watched
  separately; they are outside the advisory range and need no forced upgrade. This condition is checked against the
  registry, not signalled by the watch: the advisory is already closed, so no exit code below can reopen or re-close it.
- **Watch:** `.github/workflows/dependency-watch.yml` runs weekly (and on demand) and executes
  `scripts/check-minimatch-upstream.mjs` (`npm run deps:watch-minimatch`). It lists the holders from the lockfile, reads the
  `latest` release of each from the npm registry, and prints the minimatch range it declares. A holder whose latest release no longer
  depends on minimatch at all counts as admitting (shown as `(dropped)`). Exit codes: **10** when every holder admits a
  patched minimatch, and **11** when no package depending on a minimatch older than 11.0.1 remains (then delete the watch
  and its workflow); the workflow turns both into a failed run with an annotation and a summary line, so a red run means
  "try the upgrade". **0** means not ready. **2** means the watch itself failed (an unreadable lockfile or an unexpected
  error). Any other code, including 1 from a crash of the runtime, is reported as an error and is never the signal. A holder it cannot reach is reported as UNKNOWN and never
  counts as ready. A declared range is a prerequisite, not proof that the tool works with minimatch 11. The watch still
  lists the two 3.1.5 holders: it counts every copy below 11.0.1, not only copies inside the advisory's range. That is
  deliberate — it keeps those two holders visible — but a "not ready" line from the watch no longer means the alert is open.
  Because those two holders still declare `^3.1.2` at their latest release, exit codes 10 and 11 are unreachable today:
  the watch is a visibility check, not a gate, and a green run is the expected state. Treat a red run as "a holder moved
  upstream; re-check the override", not as "the alert is open".
- **Cadence:** the watch is weekly; the remaining holders are reviewed whenever it reports ready, and in any case at each release.

### Removing the package-scoped overrides

Remove the three exceljs-chain entries when `exceljs` (or its replacement) depends on `archiver`, `readdir-glob` and
`unzipper` releases whose own ranges already admit the patched copies. Remove the `typescript-estree` entry when that
package declares the patched line itself. After each removal run `npm install`, check `npm ls minimatch glob`, and run
the exceljs, xlsx and tooling specs listed above. Keep
`npm audit --omit=dev --registry=https://registry.npmjs.org` at zero.

### Tests

`tests/unit/tooling/minimatch-upstream-watch.spec.ts` covers the range logic, the holder listing, the failed-fetch case,
and pins two facts about `package.json`: there is no global `minimatch` or `glob` override, and the three exceljs-chain entries
above are present.
