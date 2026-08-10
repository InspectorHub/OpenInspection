# Upgrading OpenInspection

This guide covers upgrading an existing self-hosted deployment to a newer release. For a first-time deploy, see [`02_deploy.md`](02_deploy.md).

Releases are cut automatically by [release-please](https://github.com/googleapis/release-please) as GitHub Releases, each tagged `vX.Y.Z` with a generated `CHANGELOG` entry. Upgrades are always **forward-only** — you move to a newer tag, apply any new migrations, and redeploy.

---

## Before upgrading

1. **Read the release notes.** Open the [GitHub Release](https://github.com/InspectorHub/OpenInspection/releases) for the target version and read its **breaking-change** section (called out in the `CHANGELOG`). A major version bump (`X`) is the only place breaking changes ship — see [Versioning & Deprecation Policy](../../CONTRIBUTING.md#versioning--deprecation-policy).
2. **Back up D1 first.** Migrations roll forward only (see below), so take a full export before touching anything:

   ```bash
   wrangler d1 export DB --remote --output backup.sql
   ```

   Keep `backup.sql` somewhere safe until you have verified the new deploy.

---

## Upgrade steps

```bash
git fetch --tags
git checkout vX.Y.Z          # the release you are upgrading to
npm install                  # pick up any dependency changes
npm run db:migrate:remote    # apply new D1 migrations to remote
npm run deploy               # build + deploy the single Worker
```

- `npm run db:migrate:remote` wraps `wrangler d1 migrations apply DB --remote` (via `scripts/wrangler.mjs`, which resolves your wrangler config). It applies only the migrations that have not run yet.
- `npm run deploy` builds `server/` (API) + `app/` (SSR) into one Worker and ships it. The deploy script also runs `db:migrate:remote` as part of its pipeline, so migrations are applied even if you skip the explicit step above — running it first just lets you verify the migration output separately before the build.

> Standalone deploys use `wrangler.local.jsonc` for real resource IDs. `npm run deploy` and `npm run db:migrate:remote` both resolve it automatically — no flags needed.

---

## Forward-only migrations

D1 migrations in this project are **forward-only**, matching the schema-first Drizzle policy (`migrations/` is `0000_baseline.sql` + forward files):

- There are **no down migrations** and **no downgrade path**. To recover a prior state, restore the D1 export you took in [Before upgrading](#before-upgrading).
- **Never hand-edit a migration that has already been applied.** Applied migrations are immutable history; a schema change is always a new forward migration (`npm run db:generate`).
- Because there is no rollback, the pre-upgrade backup is your only safety net — always take it.

---

## What an upgrade carries — and what it does not

An upgrade moves three things automatically. Starter content is the fourth thing, and it is **not** one of them:

| on upgrade | carried? |
|---|---|
| database schema | yes — `db:migrate:remote` is in the deploy chain |
| worker code and UI | yes |
| required secrets | yes — `jwt:ensure`, `setup-code:ensure` |
| **starter content** | **no — use Settings → Data → Install what's new** |

Starter content — inspection templates, the agreement template, canned comments, event types, tags, repair items, rating systems, contractor types, services — is seeded when a workspace is **created**, and `/setup` refuses to run again once a user exists. So a release that ships a new template does not deliver it to a workspace that already exists. After upgrading, an **owner** picks it up from **Settings → Data → Install what's new** (`POST /api/admin/data/install-bundled-content`). This works in both deployment modes.

The action **adds; it never updates**. Items are matched by name, so:

- content this release ships that your workspace does not have is inserted;
- anything already present is left exactly as it is — a revised bundled template does **not** overwrite your copy;
- a bundled item you **renamed** no longer matches, so it comes back as a second copy under its original name.

Running it twice is safe: the second run inserts nothing.

---

## Verify

After the deploy finishes, hit the Worker's health endpoint and confirm the new `version` field reports the semver you just deployed:

```bash
curl https://<your-worker>.workers.dev/status
```

```json
{
  "status": "ok",
  "app": "openinspection-core",
  "version": "X.Y.Z",
  "commit": "…",
  "branch": "…",
  "buildTime": "…"
}
```

If `version` still shows the previous release, the build did not pick up the new tag — confirm `git checkout vX.Y.Z` succeeded and re-run `npm run deploy`.
