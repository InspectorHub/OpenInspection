# Publishing @inspectorhub/offline-package

This file is for maintainers. It is not shipped in the npm package.

The pipeline is shared with `@inspectorhub/field-ui`. Read
`packages/field-ui/PUBLISHING.md` for the design (why the published `LICENSE`
differs from the repository copy, the scan, the two-job workflow, rollback).
This file lists only what differs. Every script takes `--package offline-package`
(or has an `offline-package` npm script); the table of packages is
`scripts/lib/release-packages.mjs`.

## What differs

| | field-ui | offline-package |
|---|---|---|
| Package name | `@inspectorhub/field-ui` | `@inspectorhub/offline-package` |
| Release tag prefix | `field-ui-v` | `offline-package-v` |
| Manifest key | `packages/field-ui` | `packages/offline-package` |
| Publish workflow file | `publish-field-ui.yml` | `publish-offline-package.yml` |
| Staging directory | `packages/field-ui/.publish/` | `packages/offline-package/.publish/` |
| Build | `paraglide-js compile` then `tsup` | `tsup` |
| Entries | `.`, `./testing`, `./theme.css` | `.` |
| Release check | `npm run release:check:field-ui` | `npm run release:check:offline-package` |

Inside the repository the package is imported through the alias
`@core/offline-package` (tsconfig `paths` and the vite and vitest aliases), the
same way `@core/field-ui` is. Only the published name is
`@inspectorhub/offline-package`. Nothing imports the published name, so the
aliases keep resolving to the source even when `dist` has not been built.

## First publish (by hand)

The package does not exist on npm yet, so there is no trusted-publisher page to
configure. The first version is published by hand from a clean checkout of the
release commit, with your own npm login and a one-time code:

```bash
npm ci
npm run build -w @inspectorhub/offline-package
npm run stage:offline-package
node scripts/publish-field-ui.mjs --package offline-package             # dry run: reports every check
node scripts/publish-field-ui.mjs --package offline-package --confirm   # publishes
```

The version published by hand is `0.1.0`, the version in `package.json` and in
`.release-please-manifest.json`. Leave the two equal.

## Trusted publisher (npmjs.com, package settings)

Configure it after the first publish, shortly before merging the first Release
PR, because the first CI publish must succeed within 2 days of saving it.

| Field | Value |
|---|---|
| Organization or user | InspectorHub |
| Repository | OpenInspection |
| Workflow filename | publish-offline-package.yml |
| Environment | (blank) |

Renaming the workflow file breaks publishing until this entry is edited to match.

## Versions

release-please tags `offline-package-vX.Y.Z` and dispatches
`publish-offline-package.yml` with the tag as the ref. Only commits that touch
`packages/offline-package/**` count for this package, and the root package
excludes that path. Use `feat(offline-package):` and `fix(offline-package):`
for commits that touch only that directory. A commit that also touches files
outside it should use `build:`, `ci:`, `test:` or `docs:` so it does not bump
anything by accident.
