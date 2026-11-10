#!/usr/bin/env node
/**
 * Boolean-column naming gate (#227, see CLAUDE.md "Schema Rules" → Naming).
 * Every `integer(..., { mode: 'boolean' })` SQL column name MUST start with
 * `is_` or `has_` so booleans read as predicates at the DB layer. This gate
 * only inspects the SQL-name string (the `integer('<sql_name>', …)` argument);
 * the camelCase JS property is unconstrained.
 *
 * It also flags the inverse smell: a column NAMED like a predicate but stored
 * as `text(...)` instead of the real boolean type — `text('is_foo')` /
 * `text('has_foo')` should be `integer(..., { mode: 'boolean' })`.
 *
 * What this gate CANNOT see: a boolean stored as `text` under a
 * non-predicate name (e.g. `text('status')` holding `'yes'`/`'no'`). That is
 * a semantic judgement about what a column MEANS, not a naming pattern, and
 * no regex over a name can safely make that call — a heuristic guessing from
 * column names would produce false positives that train people to ignore the
 * gate, which costs more than the bug it might catch. Reviewers, not gates,
 * catch that half.
 *
 * A line can opt out with a trailing `// naming-lint-ok: <reason>` comment.
 *
 * `npm run lint:naming` runs this through check-schema-conventions.mjs
 * (`--only naming`), which reads the schema files once for this and the
 * timestamp check. This file still runs on its own.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { collectTsFiles } from './check-timestamps.mjs';

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
    const t = line.match(/text\('((?:is|has)_[a-z0-9_]+)'/);
    if (t) {
      out.push(
        `${filename}:${i + 1} column '${t[1]}' is named as a predicate but stored as text — ` +
        `booleans are integer(..., { mode: 'boolean' })`,
      );
    }
  }
  return out;
}

/**
 * The gate over a list of schema files. Called by the CLI below and by
 * check-schema-conventions.mjs, which reads the schema directory once for this
 * check and the timestamp check.
 */
export function run(files) {
  // A gate that read nothing passes everything; an empty directory is a failure.
  if (files.length === 0) {
    console.error('naming gate FAILED: read ZERO schema files from server/lib/db/schema; refusing to report OK.');
    process.exit(1);
  }
  let violations = [];
  for (const f of files) violations = violations.concat(findNamingViolations(readFileSync(f, 'utf8'), f));
  if (violations.length) {
    console.error('naming gate FAILED:\n' + violations.join('\n'));
    process.exit(1);
  }
  console.log(`naming gate OK (${files.length} schema files)`);
}

// CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  run(collectTsFiles('server/lib/db/schema'));
}
