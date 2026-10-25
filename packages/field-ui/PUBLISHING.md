# Publishing @inspectorhub/field-ui

This file is for maintainers. It is not shipped in the npm package.

The scripts and the workflow design described here are shared with
`@inspectorhub/offline-package`; see `packages/offline-package/PUBLISHING.md` for
what differs. The scripts take `--package <slug>` and default to `field-ui`.

## Why the published LICENSE differs from the repository copy

The published package carries the plain GNU Affero General Public License v3
notice. The repository copy, `packages/field-ui/LICENSE`, keeps the project's
additional permission for its own deployments and is identical to the root
`LICENSE`. It is never modified.

npm always packs the `LICENSE` that sits next to `package.json`, so the package
is built in a gitignored staging directory, `packages/field-ui/.publish/`, by
`npm run stage:field-ui`. The staged `LICENSE` is copied from
`packages/field-ui/publish-license/LICENSE-AGPL-3.0-only`. The directory is
not called `license/` because that collides with the `LICENSE` file on
case-insensitive filesystems.

## Guards

- `npm run lint:package-tarball` packs the staged directory and fails when the
  `LICENSE` lacks the AGPL title (`license-missing-agpl`), when it contains
  "additional permission" or "Section 7" (`license-extra-permission`), or when
  the README or `package.json` mention a permission, "Section 7" or
  "self-hosted" (`license-extra-permission-mention`). It fails with
  "run npm run stage:field-ui first" when the directory does not exist.
- `tests/unit/tooling/field-ui-license.spec.ts` pins the repository side: the
  package `LICENSE` equals the root `LICENSE` byte for byte, the notice has no
  additional permission, staging never touches the repository copy, and the
  staging directory is gitignored.

## One preflight, locally and in CI

`npm run release:check:field-ui` (`scripts/release-check-field-ui.mjs`) runs:
version coherence, build, stage, scan, then `npm pack --dry-run` of the staged
directory, and prints the file list, packed and unpacked size, and the sha512 of
the tarball it would produce. Pull requests run it in the `build + bundle size`
job of `ci.yml` (generic scan rules only, because the run-time patterns come
from a secret that fork pull requests do not have). The publish workflow runs the
same script with `--require-extra`.

Coherence means `.release-please-manifest.json` ("packages/field-ui"),
`packages/field-ui/package.json` and, on a tag, the tag (`field-ui-vX.Y.Z`) all
name the same version. The first release-please release bumps the first two
together.

## CI flow (`publish-field-ui.yml`)

1. release-please cuts a `field-ui-vX.Y.Z` release and dispatches the workflow
   with the tag as the ref. Guards: repository, tag ref, `field-ui-v` prefix.
2. `build` job (no `id-token`): tag-vs-version check, then the release check
   with `--require-extra`, then `npm pack` of the staged directory, a re-scan of
   the packed file, and the upload of that one tarball.
3. `publish` job (the only one with `id-token: write`): checks out nothing,
   installs no dependencies. It checks whether the version is already on the
   registry and skips the publish if so (an idempotent re-run), publishes the
   scanned tarball with provenance, and then confirms with `npm view` that the
   version is visible (provenance information is printed best effort).
4. A `concurrency` group (`publish-field-ui`, no cancellation) keeps two
   releases from publishing at once.
5. Dispatching by hand with `dry_run` set runs everything except the publish.
   The guards still apply, so a manual dry run needs an existing `field-ui-v*`
   tag as its ref; it cannot be started from a branch.

## Trusted publisher (npmjs.com, package settings)

| Field | Value |
|---|---|
| Organization or user | InspectorHub |
| Repository | OpenInspection |
| Workflow filename | publish-field-ui.yml |
| Environment | (blank) |

The first publish must succeed within 2 days of saving the trusted publisher
configuration. Renaming the workflow file breaks publishing until the entry is
edited to match.

## Manual publish

For the first publish, or any publish done by hand, use the helper from a clean
checkout of the release commit:

```bash
npm ci
npm run build -w @inspectorhub/field-ui
npm run stage:field-ui
node scripts/publish-field-ui.mjs             # dry run: reports every check, publishes nothing
node scripts/publish-field-ui.mjs --confirm   # publishes (npm prompts for the 2FA code)
```

The helper refuses to run in CI. In order, it checks that the git tree is clean,
that the staged version equals the source version, that the version is not
already on the registry, that no scoped registry setting redirects the package,
that you are logged in (a dirty tree and a missing login are warnings in a dry run and refusals with `--confirm`), and re-runs the scan (with
`--require-extra` when `PACKAGE_SCAN_EXTRA_PATTERNS` is set). It then runs
`npm publish ./packages/field-ui/.publish --access public --registry https://registry.npmjs.org`
and prints `version` and `dist.integrity` from the registry. It always passes the
registry explicitly, because some machines default to a mirror. The one-time
code goes to npm's own prompt; the helper never reads or stores it.

The equivalent by hand is `npm run lint:package-tarball` (expects 0 findings)
followed by the `npm publish` command above.

## Rollback

- A bad release is fixed by publishing a new patch version, never by editing the
  old one.
- Mark the bad version with `npm deprecate @inspectorhub/field-ui@<version> "<message>" --registry https://registry.npmjs.org`.
- Do not unpublish once the registry's unpublish window has passed; a version
  that other packages already depend on cannot be taken back.
