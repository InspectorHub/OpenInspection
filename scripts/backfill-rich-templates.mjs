#!/usr/bin/env node
/**
 * One-shot backfill: add the rich seed-templates to every existing SaaS
 * tenant. Equivalent to looping POST /api/admin/backfill-default-templates
 * once per tenant — but works against any environment without needing the
 * M2M secret in plaintext (uses wrangler's authenticated D1 connection).
 *
 * Idempotent: for each (tenant, template-name), insert only if the same
 * (tenantId, name) row doesn't already exist. Doesn't touch any rows we
 * didn't add, so the bare-fixture templates (e.g. "Residential" without
 * the "Inspection" suffix) are left alone for the user to clean up.
 *
 * Schemas can be ~40KB so we batch SQL into a tempfile and feed it to
 * `wrangler d1 execute DB --file ...` — passing on the command line
 * tripped Windows' ENAMETOOLONG.
 *
 * Usage: node scripts/backfill-rich-templates.mjs [--config wrangler.saas.toml] [--local]
 */

import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const args = new Set(process.argv.slice(2));
const configIdx = process.argv.indexOf('--config');
const configFlag = configIdx >= 0 ? process.argv[configIdx + 1] : null;
const local = args.has('--local');

const SEED_FILES = [
    'residential.json',
    'pre-listing.json',
    'new-construction.json',
    'new-construction-final.json',
    'sewer-scope.json',
    'radon.json',
    'mold-inspection.json',
];

const seeds = SEED_FILES.map((f) => {
    const raw = JSON.parse(readFileSync(join(ROOT, 'src/data/seed-templates', f), 'utf8'));
    return { name: raw.name, schema: JSON.stringify(raw.schema) };
});

const remoteFlag = local ? '--local' : '--remote';
const configArg = configFlag ? `-c "${configFlag}"` : '';
const tmp = mkdtempSync(join(tmpdir(), 'oi-backfill-'));

// `--file` mode is fast for huge INSERTs but returns only a summary (no
// query results). `--command` returns rows but is limited by the OS arg
// length. Use whichever fits the use case.
function wranglerD1FromFile(sql) {
    const file = join(tmp, `q-${randomUUID()}.sql`);
    writeFileSync(file, sql, 'utf8');
    const cmd = `npx wrangler d1 execute DB ${remoteFlag} ${configArg} --json --file "${file}"`;
    const out = execSync(cmd, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    rmSync(file);
    return out;
}

function wranglerD1Query(sql) {
    const cmd = `npx wrangler d1 execute DB ${remoteFlag} ${configArg} --json --command ${JSON.stringify(sql)}`;
    const out = execSync(cmd, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const start = out.indexOf('[');
    const end = out.lastIndexOf(']');
    if (start < 0 || end < 0) return [];
    try { return JSON.parse(out.slice(start, end + 1)); } catch { return []; }
}

function sqlEscape(s) {
    return String(s).replace(/'/g, "''");
}

console.log(`[backfill] target: ${configFlag || 'wrangler.toml'} (${local ? 'local' : 'remote'})`);

// Step 1 — list every tenant.
const tenantsRows = wranglerD1Query('SELECT id, name FROM tenants ORDER BY id');
const tenants = tenantsRows[0]?.results || [];
console.log(`[backfill] ${tenants.length} tenants`);

let totalInserted = 0;
let totalSkipped = 0;

for (const t of tenants) {
    const tenantId = String(t.id);
    const tenantName = String(t.name || tenantId.slice(0, 8));

    const existsRows = wranglerD1Query(
        `SELECT name FROM templates WHERE tenant_id = '${sqlEscape(tenantId)}'`
    );
    const existingNames = new Set((existsRows[0]?.results || []).map((r) => r.name));

    const missing = seeds.filter((s) => !existingNames.has(s.name));
    if (missing.length === 0) {
        console.log(`[backfill] ${tenantName.padEnd(40)} 0 inserted, ${seeds.length} already present`);
        totalSkipped += seeds.length;
        continue;
    }

    // Batch all missing inserts into a single file so we make one wrangler
    // call per tenant rather than 7. SQLite supports multiple statements per
    // execute; wrangler runs them as a single batch.
    // templates.created_at is `INTEGER NOT NULL` (Drizzle mode: 'timestamp',
    // serialized as ms). One INSERT at a time so a failure pinpoints the
    // specific (tenant, template) pair rather than aborting the batch.
    const nowMs = Date.now();
    let inserted = 0;
    let failed = 0;
    for (const seed of missing) {
        const id = randomUUID();
        const sql =
            `INSERT INTO templates (id, tenant_id, name, version, schema, created_at) VALUES ` +
            `('${id}', '${sqlEscape(tenantId)}', '${sqlEscape(seed.name)}', 1, '${sqlEscape(seed.schema)}', ${nowMs});`;
        try {
            wranglerD1FromFile(sql);
            inserted++;
        } catch (err) {
            failed++;
            const msg = err instanceof Error ? err.message : String(err);
            console.log(`[backfill] ${tenantName} :: ${seed.name} FAILED — ${msg.split('\n')[0].slice(0, 200)}`);
        }
    }
    totalInserted += inserted;
    totalSkipped += seeds.length - missing.length;
    const failedStr = failed > 0 ? `, ${failed} FAILED` : '';
    console.log(`[backfill] ${tenantName.padEnd(40)} +${inserted} inserted, ${seeds.length - missing.length} already present${failedStr}`);
}

rmSync(tmp, { recursive: true, force: true });
console.log(`---`);
console.log(`[backfill] done. inserted=${totalInserted}, skipped=${totalSkipped}`);
