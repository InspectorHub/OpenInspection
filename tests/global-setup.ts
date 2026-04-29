import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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
    // Delete in FK-safe order (child tables first)
    // Use --command per table because wrangler --file doesn't persist PRAGMA across statements
    const tables = [
        'audit_logs',
        'inspection_agreements',
        'inspection_results',
        'inspections',
        'availability_overrides',
        'availability',
        'tenant_invites',
        'agreements',
        'templates',
        'users',
        'tenant_configs',
        'tenants',
    ];

    try {
        // Ensure all schema migrations are applied (idempotent)
        execSync('npm run db:migrate', { cwd: appDir, stdio: 'pipe' });

        // Clear all data rows one table at a time (schema stays intact)
        for (const table of tables) {
            try {
                execSync(
                    `npx wrangler d1 execute openinspection-standalone-db --local --command "DELETE FROM ${table}" --yes`,
                    { cwd: appDir, stdio: 'pipe' },
                );
            } catch {
                // Table may not exist in older migrations — skip
            }
        }

        // Clear all KV keys (setup codes, pwchanged tokens, cached tenants)
        try {
            const toml = readFileSync(path.join(appDir, 'wrangler.toml'), 'utf8');
            const nsMatch = toml.match(/\[\[kv_namespaces\]\][^[]*?id\s*=\s*"([^"]+)"/);
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

        console.info('\n[globalSetup] Local D1 cleared — all tests will run against a fresh workspace.\n');
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
            `\n[globalSetup] WARNING: Could not reset local D1 (${msg.split('\n')[0]}).\n` +
            '  Ensure wrangler is installed and the DB was created: npx wrangler d1 create openinspection-standalone-db\n',
        );
    }
}
