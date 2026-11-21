# Publishing @inspectorhub/data-package

This file is for maintainers. It is not shipped in the npm package.

The pipeline is shared with `@inspectorhub/field-ui` and
`@inspectorhub/offline-package`. Read `packages/field-ui/PUBLISHING.md` for the
design (why the published `LICENSE` differs from the repository copy, the
tarball scan, the two-job workflow, rollback). This file lists only what
differs. Every script takes `--package data-package` (or has an npm script); the
table of packages is `scripts/lib/release-packages.mjs`.

## What differs

| | field-ui | data-package |
|---|---|---|
| Package name | `@inspectorhub/field-ui` | `@inspectorhub/data-package` |
| Release tag prefix | `field-ui-v` | `data-package-v` |
| Manifest key | `packages/field-ui` | `packages/data-package` |
| Publish workflow file | `publish-field-ui.yml` | `publish-data-package.yml` |
| Staging directory | `packages/field-ui/.publish/` | `packages/data-package/.publish/` |
| Build | `paraglide-js compile` then `tsup` | `tsup` |
| Entries | `.`, `./testing`, `./theme.css` | `.` |
| Release check | `npm run release:check:field-ui` | `npm run release:check:data-package` |

Inside the repository the package is imported through the alias
`@core/data-package` (tsconfig `paths` and the vitest aliases), the same way
`@core/offline-package` is. Only the published name is
`@inspectorhub/data-package`. Nothing imports the published name, so the alias
keeps resolving to the source even when `dist` has not been built.

## First publish (by hand)

Per owner decision, the package is **not published until the full local test
suite (library, engine, contract, app unit and Windows end-to-end) passes**. The
first publish is therefore done by hand, later than this registration. There is
no trusted-publisher page until the package exists on npm. Publish from a clean
checkout of the release commit with your own npm login and a one-time code:

```bash
npm ci
npm run build -w @inspectorhub/data-package
npm run stage:data-package
node scripts/publish-field-ui.mjs --package data-package             # dry run: reports every check
node scripts/publish-field-ui.mjs --package data-package --confirm   # publishes
```

The first version is `0.1.0`, the version in `package.json` and in
`.release-please-manifest.json`. Leave the two equal. After publishing `0.1.0`
by hand, push the tag `data-package-v0.1.0` at the published commit and create
the GitHub release for it, so release-please builds later changelogs from that
baseline rather than from the whole earlier history of the path.

## Trusted publisher (npmjs.com, package settings)

The trusted-publisher entry below is configured on npmjs.com. The first version
`0.1.0` was published by hand on 2026-11-17 (before the entry existed) and has no
provenance; the `data-package-v0.1.0` tag and GitHub Release were added at the
publishing commit to give release-please its changelog baseline. From `0.1.1` on,
every version is published by `publish-data-package.yml` via OIDC and carries
SLSA provenance. Keep the entry in place: a CI publish must succeed within 2 days
of saving it, or the binding has to be configured again.

| Field | Value |
|---|---|
| Organization or user | InspectorHub |
| Repository | OpenInspection |
| Workflow filename | publish-data-package.yml |
| Environment | (blank) |

Renaming the workflow file breaks publishing until this entry is edited to match.

## Versions

release-please tags `data-package-vX.Y.Z` and dispatches
`publish-data-package.yml` with the tag as the ref. Only commits that touch
`packages/data-package/**` count for this package, and the root package
excludes that path. Use `feat(data-package):` and `fix(data-package):` for
commits that touch only that directory. A commit that also touches files
outside it should use `build:`, `ci:`, `test:` or `docs:` so it does not bump
anything by accident.
