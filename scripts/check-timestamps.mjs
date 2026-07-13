#!/usr/bin/env node
/**
 * Timestamp-normalization gate (DBA review 2026-06-04, see CLAUDE.md "Schema
 * Rules"). New timestamp columns MUST be `integer(..., { mode: 'timestamp_ms' })`
 * (epoch milliseconds). This gate flags:
 *   - `integer('*_at')` columns with no `{ mode: 'timestamp_ms' }`
 *   - the banned seconds mode `{ mode: 'timestamp' }`
 *   - text `datetime('now')` time columns
 * A line can opt out with a trailing `// ts-lint-ok: <reason>` comment (e.g.
 * calendar-semantic `YYYY-MM-DD` fields, or a documented raw-epoch-ms design).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/** @returns {string[]} human-readable violation messages */
export function findTimestampViolations(source, filename) {
  const out = [];
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/ts-lint-ok:/.test(line)) continue;
    // Rule A: banned seconds mode anywhere
    if (/mode:\s*'timestamp'\s*\}/.test(line)) {
      out.push(`${filename}:${i + 1} uses banned mode:'timestamp' (seconds); use 'timestamp_ms'`);
      continue;
    }
    // Rule B: text time columns
    if (/datetime\('now'\)/.test(line)) {
      out.push(`${filename}:${i + 1} uses text datetime('now'); use integer timestamp_ms`);
      continue;
    }
    // Rule C: integer('*_at') must declare timestamp_ms
    const m = line.match(/integer\('([a-z0-9_]+)'/);
    if (m && /_at$/.test(m[1])) {
      if (!/mode:\s*'timestamp_ms'/.test(line)) {
        out.push(`${filename}:${i + 1} integer('${m[1]}') missing { mode: 'timestamp_ms' }`);
      }
    }
    // Rule D: text('*_at') is a timestamp stored as text — must be integer timestamp_ms.
    // Calendar/clock fields (`*_date`, `*_time`, bare `date`) are intentionally TEXT and
    // are not matched here; document them with a Schema Rules exception comment instead.
    const tm = line.match(/text\('([a-z0-9_]+)'/);
    if (tm && /_at$/.test(tm[1])) {
      out.push(`${filename}:${i + 1} text('${tm[1]}') is a text timestamp; use integer { mode: 'timestamp_ms' }`);
    }
  }
  return out;
}

// Recursively collect *.ts files under a directory. Node 22 on this repo does
// not export `globSync` from `node:fs` (that lands later), so walk manually
// instead of depending on a glob API that may not exist at runtime.
function collectTsFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...collectTsFiles(full));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

// CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const files = collectTsFiles('server/lib/db/schema');
  let violations = [];
  for (const f of files) violations = violations.concat(findTimestampViolations(readFileSync(f, 'utf8'), f));
  if (violations.length) {
    console.error('timestamp gate FAILED:\n' + violations.join('\n'));
    process.exit(1);
  }
  console.log(`timestamp gate OK (${files.length} schema files)`);
}
