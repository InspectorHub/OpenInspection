#!/usr/bin/env node
/**
 * Boolean-column naming gate (#227, see CLAUDE.md "Schema Rules" → Naming).
 * Every `integer(..., { mode: 'boolean' })` SQL column name MUST start with
 * `is_` or `has_` so booleans read as predicates at the DB layer. This gate
 * only inspects the SQL-name string (the `integer('<sql_name>', …)` argument);
 * the camelCase JS property is unconstrained.
 *
 * A line can opt out with a trailing `// naming-lint-ok: <reason>` comment.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/** @returns {string[]} human-readable violation messages */
export function findNamingViolations(source, filename) {
  const out = [];
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/naming-lint-ok:/.test(line)) continue;
    const m = line.match(/integer\('([a-z0-9_]+)'[^)]*mode:\s*'boolean'/);
    if (m && !/^(is_|has_)/.test(m[1])) {
      out.push(`${filename}:${i + 1} boolean column '${m[1]}' must start with is_/has_`);
    }
  }
  return out;
}

// Recursively collect *.ts files under a directory. Node 22 on this repo does
// not export `globSync` from `node:fs` (mirrors scripts/check-timestamps.mjs).
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
  for (const f of files) violations = violations.concat(findNamingViolations(readFileSync(f, 'utf8'), f));
  if (violations.length) {
    console.error('naming gate FAILED:\n' + violations.join('\n'));
    process.exit(1);
  }
  console.log(`naming gate OK (${files.length} schema files)`);
}
