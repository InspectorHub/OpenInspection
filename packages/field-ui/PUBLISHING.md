# Publishing @inspectorhub/field-ui

This file is for maintainers. It is not shipped in the npm package.

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

## Manual publish (the same steps as CI)

From a clean checkout of the release commit:

```bash
npm ci
npm run build -w @inspectorhub/field-ui
npm run stage:field-ui
npm run lint:package-tarball      # expects 0 findings
npm publish ./packages/field-ui/.publish --access public --registry https://registry.npmjs.org
```

Publishing needs an npm login with 2FA (npm asks for the one-time code). Always
pass the registry explicitly: some machines default to a mirror, and a publish
must never go there.
