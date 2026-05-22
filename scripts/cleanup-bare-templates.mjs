#!/usr/bin/env node
/**
 * One-shot cleanup: delete the bare "Residential" / "Pre-Listing" /
 * "Sewer Scope" templates that the old seedStarterContent path left
 * behind — but ONLY for rows that no inspection actually references
 * (to keep historical inspections intact). Idempotent.
 *
 * "My Inspection Template (Blank)" is intentionally left alone — it's
 * the documented starting point for users who want to build from scratch.
 *
 * Usage: node scripts/cleanup-bare-templates.mjs [--config wrangler.saas.toml] [--local]
 */

import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = new Set(process.argv.slice(2));
const configIdx = process.argv.indexOf('--config');
const configFlag = configIdx >= 0 ? process.argv[configIdx + 1] : null;
const local = args.has('--local');

const BARE_NAMES = ['Residential', 'Pre-Listing', 'Sewer Scope'];

const remoteFlag = local ? '--local' : '--remote';
const configArg = configFlag ? `-c "${configFlag}"` : '';

function wranglerD1Query(sql) {
    const cmd = `npx wrangler d1 execute DB ${remoteFlag} ${configArg} --json --command ${JSON.stringify(sql)}`;
    const out = execSync(cmd, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const start = out.indexOf('[');
    const end = out.lastIndexOf(']');
    if (start < 0 || end < 0) return [];
    try { return JSON.parse(out.slice(start, end + 1)); } catch { return []; }
}

function sqlEscape(s) { return String(s).replace(/'/g, "''"); }

console.log(`[cleanup] target: ${configFlag || 'wrangler.toml'} (${local ? 'local' : 'remote'})`);

// Find all candidate (tenant, template) rows.
const namesIn = BARE_NAMES.map((n) => `'${sqlEscape(n)}'`).join(',');
const candidates = wranglerD1Query(
    `SELECT t.id, t.tenant_id, t.name, ` +
    `(SELECT COUNT(*) FROM inspections WHERE template_id = t.id) AS refs ` +
    `FROM templates t WHERE t.name IN (${namesIn}) ORDER BY t.tenant_id, t.name`
);
const rows = candidates[0]?.results || [];

let deleted = 0;
let kept = 0;
for (const row of rows) {
    const refs = Number(row.refs);
    if (refs > 0) {
        console.log(`[cleanup] KEEP ${row.tenant_id}/${row.name} (${refs} inspection(s) reference it)`);
        kept++;
        continue;
    }
    wranglerD1Query(`DELETE FROM templates WHERE id = '${sqlEscape(String(row.id))}'`);
    console.log(`[cleanup] DROP ${row.tenant_id}/${row.name}`);
    deleted++;
}

console.log(`---`);
console.log(`[cleanup] done. deleted=${deleted}, kept=${kept} (still referenced)`);
