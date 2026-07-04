import { execSync } from 'child_process';
import { readFileSync, writeFileSync, rmSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { seedFixtures } from './seed-fixtures';

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

    try {
        // Ensure all schema migrations are applied (idempotent)
        execSync('npm run db:migrate', { cwd: appDir, stdio: 'pipe' });

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

        // Opt-in: the subsystem-C/D/E E2E specs use the multi-user seed.
        // Default off so the existing standalone-api/browser tests (which
        // call /api/auth/setup themselves) still see a fresh workspace.
        // Set SEED_E2E=1 when running the unskipped subsystem specs.
        if (process.env.SEED_E2E === '1') {
            console.info('\n[globalSetup] Local D1 cleared — seeding E2E fixtures (SEED_E2E=1) next.');
            try {
                seedFixtures(appDir);
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.warn(`[globalSetup] seedFixtures failed: ${msg}`);
            }
        } else {
            console.info('\n[globalSetup] Local D1 cleared (set SEED_E2E=1 to also seed C/D/E fixtures).');
        }
        console.info('[globalSetup] Ready.\n');
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
            `\n[globalSetup] WARNING: Could not reset local D1 (${msg.split('\n')[0]}).\n` +
            '  Ensure wrangler is installed and the DB was created: npx wrangler d1 create openinspection-db\n',
        );
    }
}
