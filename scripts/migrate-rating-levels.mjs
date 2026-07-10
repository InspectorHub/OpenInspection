#!/usr/bin/env node
/**
 * Pre-launch one-shot: normalize `rating_systems.levels` JSON from the
 * retired `{ abbr, bucket }` shape to the canonical
 * `{ abbreviation, severity, isDefect, pausesAdvance? }` shape (module F —
 * see app/lib/severity.ts / server/lib/validations/rating-system.schema.ts).
 *
 * Companion to migrations/data/2026-07-04-severity-normalization.sql (which
 * normalizes `comments.severity`). This script handles `rating_systems`
 * because its levels are JSON-encoded, not a flat column the SQL file's
 * UPDATE statements can reach directly.
 *
 * NOT a drizzle migration — this is a DATA migration, run manually
 * pre-launch. Local rows only have a handful of seeded/cloned systems, so a
 * per-row Node normalizer is simpler than hand-writing JSON1 SQL.
 *
 *   node scripts/migrate-rating-levels.mjs --local
 *   node scripts/migrate-rating-levels.mjs --remote
 *
 * Per the D1 migration SOP (docs/saas-ops/d1-migration-sop.md), take a
 * `d1 export --remote` backup before running with --remote.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const isRemote = args.includes('--remote');
const isLocal = args.includes('--local');
if (isRemote === isLocal) {
  console.error('Specify exactly one of --local or --remote.');
  process.exit(1);
}
const scope = isRemote ? '--remote' : '--local';
const wranglerShim = join(import.meta.dirname, 'wrangler.mjs');

function wrangler(extraArgs) {
  return execFileSync(process.execPath, [wranglerShim, ...extraArgs], { encoding: 'utf8' });
}

/** bucket -> severity (module F's single canonical vocabulary). */
const BUCKET_TO_SEVERITY = {
  satisfactory: 'good',
  monitor: 'marginal',
  defect: 'significant',
  na: 'minor',
};

/** Normalize one level: legacy {abbr,bucket} -> canonical {abbreviation,severity,isDefect}. */
function normalizeLevel(lvl) {
  if (lvl && typeof lvl === 'object' && 'severity' in lvl && 'abbreviation' in lvl) {
    // Already canonical (e.g. re-run, or a system created after module F shipped).
    return lvl;
  }
  const bucket = lvl?.bucket;
  const severity = BUCKET_TO_SEVERITY[bucket] ?? 'minor';
  const normalized = {
    ...(lvl?.id ? { id: lvl.id } : {}),
    label: lvl?.label ?? '',
    abbreviation: lvl?.abbr ?? lvl?.label ?? '',
    color: lvl?.color ?? '#9ca3af',
    severity,
    isDefect: bucket === 'defect',
    ...(typeof lvl?.pausesAdvance === 'boolean' ? { pausesAdvance: lvl.pausesAdvance } : {}),
    ...(lvl?.hotkey ? { hotkey: lvl.hotkey } : {}),
    ...(typeof lvl?.order === 'number' ? { order: lvl.order } : {}),
  };
  return normalized;
}

// 1. Read every rating_systems row.
const listSql = 'SELECT id, levels FROM rating_systems;';
const parsed = JSON.parse(wrangler(['d1', 'execute', 'DB', scope, '--json', '--yes', '--command', listSql]));
const rows = Array.isArray(parsed) ? (parsed[0]?.results ?? []) : (parsed?.results ?? []);

if (!rows.length) {
  console.log(`No rating_systems rows on ${scope} — nothing to normalize.`);
  process.exit(0);
}

// 2. Normalize + build one UPDATE per row (levels JSON differs per row, so a
// single templated UPDATE can't cover them all).
const statements = [];
let changed = 0;
for (const row of rows) {
  const raw = row.levels;
  let levels;
  try {
    levels = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    console.warn(`Skipping rating_systems.id=${row.id} — unparseable levels JSON.`);
    continue;
  }
  if (!Array.isArray(levels)) continue;
  const alreadyCanonical = levels.every((l) => l && typeof l === 'object' && 'severity' in l && 'abbreviation' in l);
  if (alreadyCanonical) continue;
  const normalized = levels.map(normalizeLevel);
  const json = JSON.stringify(normalized).replace(/'/g, "''");
  statements.push(`UPDATE rating_systems SET levels = '${json}' WHERE id = '${String(row.id).replace(/'/g, "''")}';`);
  changed++;
}

if (!statements.length) {
  console.log(`All ${rows.length} rating_systems row(s) on ${scope} already canonical — nothing to do.`);
  process.exit(0);
}

const tmp = join(process.cwd(), `.migrate-rating-levels.${isRemote ? 'remote' : 'local'}.sql`);
writeFileSync(tmp, statements.join('\n') + '\n', 'utf8');
try {
  console.log(`Normalizing ${changed} of ${rows.length} rating_systems row(s) on ${scope}…`);
  wrangler(['d1', 'execute', 'DB', scope, '--file', tmp, '--yes']);
  console.log('✓ rating_systems.levels normalized to the canonical abbreviation/severity shape.');
} finally {
  rmSync(tmp, { force: true });
}
