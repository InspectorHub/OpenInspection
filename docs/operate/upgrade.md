# Upgrading OpenInspection

This guide covers upgrading an existing self-hosted deployment to a newer release. For a first-time deploy, see [`deploy.md`](deploy.md).

Releases are cut automatically by [release-please](https://github.com/googleapis/release-please) as GitHub Releases, each tagged `vX.Y.Z` with a generated `CHANGELOG` entry. Upgrades are **forward-only** — you move to a newer tag, apply any new migrations, and redeploy.

> **This release rebuilt the baseline migration.** It replaced the *contents* of `migrations/0000_baseline.sql` and deleted the forward files it now covers. `wrangler` decides what to apply by comparing migration **filenames** against the ones your database has already recorded, so a rebuilt baseline is invisible to it: the steps below will apply nothing and, in the most common case, will report success while doing it. Read **[Upgrading across a rebuilt baseline](#upgrading-across-a-rebuilt-baseline)** first and follow it instead. It is a one-time reconcile, and afterwards normal upgrades resume.

---

## Before upgrading

1. **Read the release notes.** Open the [GitHub Release](https://github.com/InspectorHub/OpenInspection/releases) for the target version and read its **breaking-change** section (called out in the `CHANGELOG`). A major version bump (`X`) is the only place breaking changes ship — see [Versioning & Deprecation Policy](../../CONTRIBUTING.md#versioning--deprecation-policy).
2. **Back up D1 first — both ways.** Migrations roll forward only (see below), so take a full export *and* note a Time Travel bookmark before touching anything:

   ```bash
   wrangler d1 export DB --remote --output backup.sql
   wrangler d1 time-travel info <your-d1-database-name>   # prints the current bookmark — write it down
   ```

   The export is your portable copy; the bookmark is the fastest way back (`wrangler d1 time-travel restore <your-d1-database-name> --bookmark=<bookmark>`) if a hand-run statement goes wrong. Time Travel is remote-only and needs the database **name** from your wrangler config, not the `DB` binding. Keep `backup.sql` somewhere safe until you have verified the new deploy.

3. **Ask your database what it has actually applied.** The upgrade steps below assume its migration ledger and this checkout agree. Confirm that before trusting them — see [Upgrading across a rebuilt baseline](#upgrading-across-a-rebuilt-baseline).

---

## Upgrade steps

```bash
git fetch --tags
git checkout vX.Y.Z          # the release you are upgrading to
npm install                  # pick up any dependency changes
npm run db:migrate:remote    # apply new D1 migrations to remote
npm run deploy               # build + deploy the single Worker
```

- `npm run db:migrate:remote` wraps `wrangler d1 migrations apply DB --remote` (via `scripts/wrangler.mjs`, which resolves your wrangler config). It applies the migrations that have not run yet — and it decides that by **filename**, comparing `migrations/*.sql` against the `d1_migrations` table in your database. It never compares contents. A migration file that was rewritten in place has already "run" by that test, so you get `No migrations to apply!` and a schema that did not move. That is exactly what this release does to an existing database; see [Upgrading across a rebuilt baseline](#upgrading-across-a-rebuilt-baseline).
- `npm run deploy` builds `server/` (API) + `app/` (SSR) into one Worker and ships it. The pipeline is `build → db:migrate:remote → db:lag → wrangler deploy → jwt:ensure → setup-code:ensure`, so migrations are applied even if you skip the explicit step above — running it first just lets you verify the migration output separately before the build.
- `db:lag` is the guard in the middle of that pipeline. It queries your database's `d1_migrations` table and prints the number of migrations in this checkout next to the number the database has applied. If a migration in the repo is not applied, or the database carries a name this checkout does not have, it **aborts the deploy before `wrangler deploy` runs**. It compares names, so it cannot see a rebuilt baseline either — one name on each side counts as agreement. Run it on its own any time: `npm run db:lag`.

> Standalone deploys use `wrangler.local.jsonc` for real resource IDs. `npm run deploy` and `npm run db:migrate:remote` both resolve it automatically — no flags needed.

---

## Forward-only migrations

D1 migrations in this project are **forward-only**, matching the schema-first Drizzle policy. `migrations/` currently holds a single regenerated `0000_baseline.sql`; schema work from here adds forward files on top of it.

- There are **no down migrations** and **no downgrade path**. To recover a prior state, restore the D1 export or the Time Travel bookmark you took in [Before upgrading](#before-upgrading).
- **Never hand-edit a migration that has already been applied — with one exception, which this release used.** For ordinary schema work the rule is absolute: a change is always a new forward migration (`npm run db:generate`). Editing an applied file changes what *new* databases build while leaving every *existing* database untouched, and no tool compares the two. The exception is a deliberate **baseline rebuild**: regenerating `0000_baseline.sql` from the schema and deleting the forward files it now covers, so a fresh install runs one file instead of dozens. That is a hand-edit of an applied migration by any other name, it is done at most once per major release, and it is why existing databases need the one-time reconcile in [Upgrading across a rebuilt baseline](#upgrading-across-a-rebuilt-baseline). Do not do it yourself in a fork you also deploy from.
- Because there is no rollback, the pre-upgrade backup is your only safety net — always take it.

---

## This release moves signature evidence between tables

Two migrations relocate the client's signature on a signed agreement. Read this
before you upgrade, because one of them can **stop** — deliberately — and what
you do then matters.

### What moves

```
agreement_requests.signature_base64   →   agreement_signers.signature_base64
```

The signature used to be written twice: once on the row of the person who signed
and once on the agreement envelope. The envelope copy is removed and the column
dropped.

### Why

The envelope copy could not say whose signature it was. An agreement can be sent
to several people, each signing on their own row; the envelope has one signature
field and no author, so when two people signed it held whichever signature was
written last. Nothing read it as evidence, and keeping a second copy that cannot
identify its signer is worse than keeping one that can.

Nothing about how the signature is treated changes: same retention period, same
legal basis, same destruction behaviour, same appearance on the signed PDF. Each
signer row now also records **how** its signature came to be attributed to that
person — captured at signing, or relocated by these migrations, and from what.

### What the migrations will and will not do

| your data | what happens |
|---|---|
| envelope signature, exactly one signer row | the signature moves to that row |
| envelope signature, no signer rows | a client signer row is created for it, using the recipient name and email the envelope recorded |
| envelope signature, several signer rows, none holding a signature | **the migration stops** |

The last case has no recorded author, and the migration will not pick one. It
counts the signatures that did not reach a signer row and **aborts before
dropping the column**, leaving your data exactly as it was. You get a failed
migration, not a silent loss.

The stopping case is not produced by anything the software itself does. If you
hit it, the likeliest cause is a retention sweep that destroyed signer-level
signatures without reaching the envelope.

### What you should do

1. **Back up your database before upgrading** — the usual export plus a Time
   Travel bookmark, as in [Before upgrading](#before-upgrading). There is no
   down migration.
2. If the migration stops, **do not resolve it by assigning the signature to a
   signer you think is the right one.** Naming an author the record does not
   name creates a fact about who signed, in data that exists precisely to
   evidence who signed. Restore from backup, or work out from your own records
   and your own legal advice what the row should say, before re-running.
3. Re-running after you have corrected the data is safe. The relocation is
   idempotent and can be applied again; it is a separate migration from the one
   that adds the columns for exactly this reason.
4. **Check the result, do not assume it.** After upgrading, confirm that every
   signed agreement still has a signature behind it:

   ```bash
   wrangler d1 execute <your-db> --remote --command      "SELECT COUNT(*) AS unexplained FROM agreement_requests r
      WHERE r.status='signed' AND r.purged_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM agreement_signers s
                        WHERE s.request_id=r.id AND s.signature_base64 IS NOT NULL)"
   ```

   It must return `0`. A later migration asserts the same thing and will refuse
   to complete if it does not, so you will not be able to upgrade past a
   deployment that lost signature evidence — but knowing early is better than
   finding out at the next upgrade.

**Nothing is deleted silently.** Retained signature evidence is moved, never
discarded: the old column is removed only after every signature it held has been
verified to sit on a signer row. If that verification fails the migration stops
with your data intact, and the column stays until the situation is resolved.

---

## Upgrading across a rebuilt baseline

**Do this before `npm run db:migrate:remote` or `npm run deploy`, not after.**

This release replaced a sixty-nine file migration chain with a single regenerated `migrations/0000_baseline.sql` — the same filename that was already there. `wrangler d1 migrations apply` compares filenames against the `d1_migrations` table in your database and applies whatever names are missing. Both sides now say `0000_baseline.sql`, so there is nothing missing, so nothing runs. Your schema stays where it was and the new Worker code is written against where it should have gone.

A fresh install is unaffected: it runs the new baseline once and is correct. Everything below is for a database that already exists.

### 1. Find out which case you are in

```bash
npx wrangler d1 execute DB --remote --command "SELECT name FROM d1_migrations ORDER BY name"
```

| What you see | What happens on upgrade |
|---|---|
| **A.** One row, `0000_baseline.sql`, nothing else | `db:migrate:remote` prints `No migrations to apply!` **and `db:lag` reports "in sync"** — one name on each side. Nothing stops the deploy. This is the dangerous case, because every tool reports success. |
| **B.** `0000_baseline.sql` plus numbered rows | `db:lag` fails and aborts the deploy: `N migration(s) APPLIED OUT OF BAND (not in this repo)`. Nothing was applied out of band — those are the names of the files this release deleted. |
| **C.** No `0000_baseline.sql` row (or no `d1_migrations` table at all) | Your install predates the earlier consolidation. `db:migrate:remote` will try to run the baseline against tables that already exist and fail with `table … already exists`. |

Case **A** is where most operators who upgrade tag to tag will be. Treat "no migrations to apply" on this upgrade as a symptom, not as good news.

### 2. Back up, both ways

Take the export **and** the Time Travel bookmark from [Before upgrading](#before-upgrading) before running anything in this section. Steps 4 and 5 edit your database by hand; Time Travel is what makes that reversible.

### 3. Bring your schema current on the pre-rebuild chain

Do this **first**, and from your *old* checkout state — not from the new tag. The forward files this release removed are still in git history:

```bash
git fetch --tags
git log --oneline --diff-filter=D -1 -- 'migrations/*.sql'   # the commit that removed the chain
git checkout <that-commit>^                                  # the last tree that still carried it
npm ci
npm run db:migrate:remote                                    # applies everything your database is missing
```

Then check out the release you are upgrading to (`git checkout vX.Y.Z && npm install`) and continue.

If that tree does not carry every removed file — a release branch can add and then remove files inside a single squashed commit — it still brings you most of the way, and step 5 covers the column retirements that landed with the rebuild itself. Step 6 is what tells you whether anything is still missing; do not skip it.

Case **C** databases also have to end up with a `d1_migrations` row for the baseline, which step 4 covers.

### 4. Rewrite the migration ledger

**Only after step 3.** This is what our own production database did:

```bash
npx wrangler d1 execute DB --remote --command "DELETE FROM d1_migrations WHERE name != '0000_baseline.sql'"
```

It edits the ledger only — no table, no column, no row of your data is touched. It leaves the one name this checkout still contains, which `wrangler` already considers applied, so a later `db:migrate:remote` is a clean no-op instead of a failure.

Run it on a database that is **not** current and you delete the only record of what it is missing. After that, no tool in this repo can tell you — `db:lag` will read "in sync" and mean nothing by it. That is the whole reason step 3 comes first.

Case **C** only — there is no baseline row to keep, so add one:

```bash
npx wrangler d1 execute DB --remote --command "INSERT INTO d1_migrations (name) SELECT '0000_baseline.sql' WHERE NOT EXISTS (SELECT 1 FROM d1_migrations WHERE name = '0000_baseline.sql')"
```

### 5. Apply the column retirements by hand

This release retires nine columns. Production got them from forward migrations that ran *before* the rebuild; those files no longer exist, so **no migration in this repo can drop them for you**. The new code does not bind any of the nine. Three of them are `NOT NULL` with no default, which means an insert that omits them fails outright rather than degrading:

| Table | Column | Old definition | What breaks if it stays |
|---|---|---|---|
| `tenants` | `name` | `text NOT NULL` | `/setup` — creating the first workspace fails |
| `automations` | `subject_template` | `text NOT NULL` | automation seeding, on `GET /api/automations` and on every automation trigger |
| `automations` | `body_template` | `text NOT NULL` | same |
| `automations` | `sms_body` | `text` | nothing; dead storage |
| `comments` | `rating_bucket` | `text`, indexed | nothing; dead storage |
| `inspection_events` | `gcal_event_id` | `text` | nothing; dead storage |
| `inspections` | `lead_inspector_id` | `text` | nothing; dead storage |
| `inspections` | `helper_inspector_ids` | `text DEFAULT '[]' NOT NULL` | nothing; the default satisfies the constraint |
| `inspections` | `data_version` | `integer DEFAULT 0 NOT NULL` | nothing; the default satisfies the constraint |

**Run the two backfill statements before dropping `tenants.name`.** For any workspace whose company name was never set, `tenants.name` is the only name it has anywhere — dropping the column without this leaves it blank in the agent directory, in invite emails and on public profiles. Both statements are idempotent and match nothing on a second run; a workspace that has its own company name is untouched.

```sql
UPDATE tenant_configs
   SET company_name = (SELECT t.name FROM tenants t WHERE t.id = tenant_configs.tenant_id),
       updated_at   = unixepoch('now') * 1000
 WHERE (company_name IS NULL OR TRIM(company_name) = '')
   AND EXISTS (SELECT 1 FROM tenants t WHERE t.id = tenant_configs.tenant_id AND TRIM(t.name) <> '');

INSERT INTO tenant_configs (tenant_id, company_name, updated_at)
SELECT t.id, t.name, unixepoch('now') * 1000
  FROM tenants t
 WHERE TRIM(t.name) <> ''
   AND NOT EXISTS (SELECT 1 FROM tenant_configs c WHERE c.tenant_id = t.id);
```

Then the retirements. **The index goes first** — SQLite refuses to drop a column an index names:

```sql
DROP INDEX `idx_comments_rating_bucket`;
ALTER TABLE `comments` DROP COLUMN `rating_bucket`;
ALTER TABLE `tenants` DROP COLUMN `name`;
ALTER TABLE `automations` DROP COLUMN `subject_template`;
ALTER TABLE `automations` DROP COLUMN `body_template`;
ALTER TABLE `automations` DROP COLUMN `sms_body`;
ALTER TABLE `inspection_events` DROP COLUMN `gcal_event_id`;
ALTER TABLE `inspections` DROP COLUMN `lead_inspector_id`;
ALTER TABLE `inspections` DROP COLUMN `helper_inspector_ids`;
ALTER TABLE `inspections` DROP COLUMN `data_version`;
```

Put the backfill in one file and the retirements in another, and run the backfill first:

```bash
npx wrangler d1 execute DB --remote --file backfill-company-name.sql
npx wrangler d1 execute DB --remote --file retire-columns.sql
```

`no such column` on one of the retirements means step 3 already dropped it — that statement is done, delete that line and re-run the file. `no such index` on the first line means the same. Statements before the failing one have already been applied, so only the remainder needs re-running. These are native `ALTER TABLE … DROP COLUMN` statements: SQLite removes the column in place, copies no table and deletes no rows. Do not replace them with a generated migration — drizzle emits a twelve-step table rebuild for this shape, and its `DROP TABLE` step loses rows that other tables reference, because D1 cannot relax foreign-key enforcement outside a transaction.

### 6. Verify before you deploy

```bash
npm run db:lag
```

Expect `✅ in sync`. On a Case **A** database it said that before you started, so it is confirmation and not proof. The proof is comparing the schema itself against the baseline this release ships:

```bash
npx wrangler d1 export DB --remote --no-data --output live-schema.sql

# a throwaway local database built from migrations/0000_baseline.sql alone.
# wipe:d1:local erases your LOCAL dev database only — it never touches --remote.
npm run wipe:d1:local
npm run db:migrate
npx wrangler d1 export DB --local --no-data --output baseline-schema.sql
```

Compare the two. Statement order, quoting and the way SQLite records an added column will differ — that is normal, and the rebuild itself was accepted on the same basis. What must **not** differ is the set of tables, the set of columns in each table, and the set of indexes. A table or column present in `baseline-schema.sql` and absent from `live-schema.sql` is something step 3 did not deliver; the new code expects it.

Only then run `npm run deploy`.

### What `db:lag`'s "database is AHEAD" message means here

Case **B** operators get this, and its first two explanations do not apply:

```
  ✘ N migration(s) APPLIED OUT OF BAND (not in this repo):
```

Nobody applied SQL out of band and your branch does not predate production. Those names are the forward files this release folded into the baseline; your database is right to remember them and this checkout is right not to have them. Steps 3 to 5 are the fix — the ledger rewrite in step 4 is what clears the message. Do **not** add the names to `scripts/migration-lag-baseline.json` instead: that allowlist silences the report without reconciling anything, and it exists for a database whose ledger you deliberately chose to leave alone.

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
