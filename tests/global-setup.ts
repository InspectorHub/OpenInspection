import { execSync } from 'child_process';
import { createHash } from 'crypto';
import { readFileSync, writeFileSync, rmSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { seedFixtures } from './seed-fixtures';
import { clearEditorSeed } from './e2e/helpers/editor-seed';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Playwright globalSetup — runs once before the test suite.
 *
 * Clears all rows from every table in the local D1 database so that
 * POST /setup always returns 200 (fresh workspace) and every test
 * that requires a real token runs instead of being skipped.
 *
 * Requires the dev server to be running (`npm run dev` in apps/core).
 * The setup wizard no longer uses a module-level cache, so the cleared
 * DB is reflected immediately without restarting the dev server.
 */
export default function globalSetup() {
    const appDir = path.resolve(__dirname, '..');

    // Drop last run's editor-seed handoff so a stale inspection id (whose D1 rows
    // are wiped below) can never leak into a run where the seed project is not in
    // the selected set. The `editor-seed` setup project rewrites it when it runs.
    clearEditorSeed();

    // Resolve the SAME wrangler config the webServer builds/runs against
    // (vite `configPath`: WRANGLER_CONFIG > wrangler.local.jsonc > wrangler.jsonc)
    // so `d1 execute --local` targets the exact persisted SQLite the worker reads.
    // Pass it explicitly via -c; also target the `DB` BINDING (not a database
    // NAME) — wrangler auto-discovers only wrangler.jsonc, and the old code
    // executed against a database name that isn't in the config at all, so every
    // DELETE errored and was silently swallowed → the DB was never cleared → the
    // next run's POST /api/auth/setup saw last run's workspace and 409'd.
    const cfg =
        process.env.WRANGLER_CONFIG ||
        (existsSync(path.join(appDir, 'wrangler.local.jsonc')) ? 'wrangler.local.jsonc' : 'wrangler.jsonc');
    const d1File = (file: string, extra = '') =>
        `npx wrangler d1 execute DB --local -c ${cfg} --file "${file}" ${extra}`.trim();
    const tmp = (name: string) => path.join(appDir, name);

    // Set the moment the SEED_E2E=1 branch is entered, so the outer catch can
    // tell "the optional D1 reset did not work" (a warning) from "the seed the
    // caller explicitly asked for did not work" (fatal).
    let seedRequested = false;

    // Migrations are deliberately OUTSIDE the soft-failure block below. A
    // database that did not migrate is not "slightly stale" — every assertion
    // after it is meaningless, so this fails the run rather than warning.
    //
    // 2026-08-11 is why. `execSync`'s default 1 MB `maxBuffer` overflowed on a
    // release that added seven migrations at once; the child died with ENOBUFS,
    // the catch below downgraded it to a WARNING, and the suite then ran against
    // a database missing `tenant_configs.legal_name`. Result: 39 specs "passed",
    // one failed with a 500 nobody could explain, and 151 never ran. The warning
    // is what made a broken database look like a working one.
    //
    // maxBuffer is generous because migration output grows with the chain, and
    // this failure mode stays invisible until it is expensive.
    try {
        execSync('npm run db:migrate', {
            cwd: appDir, stdio: 'pipe', maxBuffer: 64 * 1024 * 1024,
        });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
            '[globalSetup] db:migrate FAILED — the local D1 schema is not current, so every ' +
            'spec in this run would assert against the wrong database. Fatal on purpose.\n' + msg,
            { cause: err },
        );
    }

    try {

        // Wipe every data table, not a hand-maintained subset. The old 13-table
        // list missed the many child tables that reference inspections/tenants
        // (invoices, services, documents, messages, …); with D1's FK enforcement
        // ON (PRAGMA foreign_keys = 1) a DELETE FROM tenants then fails — and the
        // curated "FK-safe order" can never stay complete as the schema grows.
        // Instead: enumerate all tables from sqlite_master and delete them in one
        // batch with `PRAGMA defer_foreign_keys = ON`, which holds FK checks until
        // the batch commits (all rows gone → no violations). d1_migrations and the
        // internal _cf_* bookkeeping tables are preserved so migrations stay applied.
        const listSql = tmp('.gs-list.sql');
        const wipeSql = tmp('.gs-wipe.sql');
        try {
            writeFileSync(
                listSql,
                "SELECT name FROM sqlite_master WHERE type='table' " +
                    "AND name NOT LIKE 'sqlite_%' AND name NOT GLOB '_cf_*' " +
                    "AND name <> 'd1_migrations' ORDER BY name;\n",
            );
            const out = execSync(d1File(listSql, '--json'), { cwd: appDir, encoding: 'utf8' });
            const parsed = JSON.parse(out.slice(out.indexOf('['))) as { results: { name: string }[] }[];
            const tables = parsed[0]?.results?.map((r) => r.name) ?? [];
            if (tables.length > 0) {
                const wipe =
                    'PRAGMA defer_foreign_keys = ON;\n' +
                    tables.map((t) => `DELETE FROM "${t}";`).join('\n') +
                    '\n';
                writeFileSync(wipeSql, wipe);
                execSync(d1File(wipeSql, '--yes'), { cwd: appDir, stdio: 'pipe' });
            }
        } finally {
            rmSync(listSql, { force: true });
            rmSync(wipeSql, { force: true });
        }

        // Clear all KV keys (setup codes, pwchanged tokens, cached tenants)
        try {
            const cfgRaw = readFileSync(path.join(appDir, cfg), 'utf8');
            const nsMatch = cfgRaw.match(/"kv_namespaces"[^\]]*?"id":\s*"([^"]+)"/);
            const nsId = nsMatch?.[1];
            if (nsId) {
                const listOutput = execSync(
                    `npx wrangler kv key list --namespace-id ${nsId} --local`,
                    { cwd: appDir, encoding: 'utf8' },
                );
                const keys = JSON.parse(listOutput) as { name: string }[];
                for (const key of keys) {
                    try {
                        execSync(
                            `npx wrangler kv key delete "${key.name}" --namespace-id ${nsId} --local`,
                            { cwd: appDir, stdio: 'pipe' },
                        );
                    } catch { /* ignore */ }
                }
            }
        } catch {
            // KV may not be initialized — that's fine
        }

        // Publish agent terms.
        //
        // NOT part of the opt-in fixture set below, because it is not a fixture:
        // `POST /api/agent-signup` assembles the acceptance server-side from the
        // text in force and refuses outright when no version is published — an
        // agent's agreement to a document that does not exist is not a thing to
        // record. So a workspace without agent terms genuinely cannot create an
        // agent account, and any spec that needs one needs this first, whether or
        // not SEED_E2E is set. (The job labelled "seeded D1" runs plain
        // `playwright test` and never sets it, which is why putting this in
        // seedFixtures fixed nothing.)
        //
        // The row has no tenant: an agent account is global, so the counterparty
        // is whoever operates the deployment. `deployment_legal_versions` is that
        // table, and the shape follows from that — one
        // acceptance covers the whole deployment, so the ledger is
        // `agent × terms version` rather than `agent × company × terms version`.
        //
        // Deliberately NOT the real document. `app/content/legal/agent-terms.md`
        // is an unapproved draft that `agent-terms:publish` refuses to publish
        // while it still carries placeholders, and that refusal is a shipped
        // safeguard the tests must not route around. A short fixture body keeps
        // the e2e testing the MECHANISM (a published version opens signup) instead
        // of smuggling an unapproved contract into a database.
        //
        // The hash is DERIVED from the body: the service hashes it with SHA-256 and
        // a verifier re-derives it later, so a hand-written digest would seed a row
        // that fails its own check.
        try {
            const body = 'E2E agent terms fixture. Not a real agreement.';
            const hash = createHash('sha256').update(body, 'utf8').digest('hex');
            const agentTermsSql = tmp('.gs-agent-terms.sql');
            writeFileSync(agentTermsSql,
                `INSERT OR REPLACE INTO deployment_legal_versions `
                + `(id, doc, version, body_snapshot, content_hash, published_at) `
                + `VALUES ('e2e-agent-terms', 'agent_terms', '2026-08-01', `
                + `'${body}', '${hash}', ${Date.now()});\n`);
            try {
                execSync(d1File(agentTermsSql, '--yes'), { cwd: appDir, stdio: 'pipe' });
            } finally {
                rmSync(agentTermsSql, { force: true });
            }
        } catch (err) {
            // Loud, not swallowed. A silently missing row does not look like a
            // missing row — it looks like agent signup returning 400, which is
            // indistinguishable from the product being broken.
            throw new Error(
                '[globalSetup] failed to publish agent terms — agent signup will refuse every request\n  '
                + (err instanceof Error ? err.message : String(err)),
            );
        }

        // Opt-in: the subsystem-C/D/E E2E specs use the multi-user seed.
        // Default off so the existing standalone-api/browser tests (which
        // call /api/auth/setup themselves) still see a fresh workspace.
        // Set SEED_E2E=1 when running the unskipped subsystem specs.
        if (process.env.SEED_E2E === '1') {
            console.info('\n[globalSetup] Local D1 cleared — seeding E2E fixtures (SEED_E2E=1) next.');
            // NOT wrapped in a try/catch. SEED_E2E=1 means the seed was asked
            // for explicitly, and every spec downstream depends on the rows it
            // writes. A swallowed failure here does not make the run more
            // robust — it makes the run LIE: the specs then fail at a login or
            // a missing inspection id, which reads as a broken feature rather
            // than a broken fixture. Five separate defects in seed-fixtures.ts
            // (wrong database name, missing -c, embedded newlines cmd.exe
            // rejects, a password-hash format verifyPassword can never match,
            // and a tenant id standalone login cannot resolve) survived for
            // months behind that console.warn. Fail loudly instead.
            //
            // The flag is what carries the throw PAST the outer catch below,
            // which exists to tolerate a missing/unbuilt local D1 and would
            // otherwise re-swallow this as the same soft warning.
            seedRequested = true;
            seedFixtures(appDir);
        } else {
            console.info('\n[globalSetup] Local D1 cleared (set SEED_E2E=1 to also seed C/D/E fixtures).');
        }
        console.info('[globalSetup] Ready.\n');
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (seedRequested) {
            // SEED_E2E=1 was passed: the seed is a precondition, not a nicety.
            throw new Error(
                `[globalSetup] seedFixtures failed with SEED_E2E=1 — the seeded specs cannot run.\n${msg}`,
                { cause: err },
            );
        }
        console.warn(
            `\n[globalSetup] WARNING: Could not reset local D1 (${msg.split('\n')[0]}).\n` +
            '  Ensure wrangler is installed and the DB was created: npx wrangler d1 create openinspection-db\n',
        );
    }
}
