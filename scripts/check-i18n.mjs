#!/usr/bin/env node
/**
 * i18n formatting gate (see docs/superpowers/plans/2026-07-16-oi-i18n-*).
 *
 * Phase A routed every user-facing date/time/number/currency render through the
 * shared locale-aware formatter (app/lib/format.ts + server/lib/format.ts), driven
 * by the viewer's effective locale/timezone/currency. This gate stops NEW hardcoded
 * `en-US` formatting from creeping back in: such a call ignores the tenant/user
 * locale, so a Spanish viewer silently gets English output.
 *
 * Flags a hardcoded English locale passed to a runtime formatter:
 *   `.toLocaleDateString('en-US', …)` / `.toLocaleTimeString('en-US', …)` /
 *   `.toLocaleString('en-US', …)` and `Intl.DateTimeFormat('en-US', …)` /
 *   `Intl.NumberFormat('en-US', …)`.
 *
 * A line opts out with a trailing — or immediately preceding — `// i18n-lint-ok:
 * <reason>` comment (e.g. a locale-neutral offset computation).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const TO_LOCALE = /\.toLocale(Date|Time|)String\(\s*['"]en-US['"]/;
const INTL = /Intl\.(DateTime|Number)Format\(\s*['"]en-US['"]/;

/** @returns {string[]} human-readable violation messages */
export function findI18nViolations(source, filename) {
  const out = [];
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/i18n-lint-ok:/.test(line) || /i18n-lint-ok:/.test(lines[i - 1] ?? '')) continue;
    if (TO_LOCALE.test(line) || INTL.test(line)) {
      out.push(
        `${filename}:${i + 1} hardcodes the 'en-US' locale in a formatter; ` +
          `route through the shared formatter with the viewer's effective locale ` +
          `(useDisplayLocale / resolveLocale), or annotate '// i18n-lint-ok: <reason>'`,
      );
    }
  }
  return out;
}

// Scan app/ + server/. Exclude the formatter modules themselves (the canonical
// en-US default lives there), the tz-offset picker labels (locale-neutral by
// design), and tz.ts (Intl.DateTimeFormat('en-US') is offset math, not content).
const SCOPE = ['app', 'server'];
const EXCLUDE = [
  'app/lib/format.ts',
  'app/lib/format-date.ts',
  'server/lib/format.ts',
  'server/lib/tz.ts',
  'app/lib/timezones.ts',
];

function collectFiles(path) {
  const out = [];
  let stat;
  try {
    stat = statSync(path);
  } catch {
    return out;
  }
  if (stat.isFile()) {
    const norm = path.replace(/\\/g, '/');
    if (!/\.(ts|tsx)$/.test(path)) return out;
    if (/\.(test|spec)\.(ts|tsx)$/.test(path)) return out;
    if (EXCLUDE.some((e) => norm.endsWith(e))) return out;
    out.push(path);
    return out;
  }
  for (const entry of readdirSync(path)) out.push(...collectFiles(join(path, entry)));
  return out;
}

// CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const files = SCOPE.flatMap(collectFiles);
  let violations = [];
  for (const f of files) violations = violations.concat(findI18nViolations(readFileSync(f, 'utf8'), f));
  if (violations.length) {
    console.error('i18n gate FAILED:\n' + violations.join('\n'));
    process.exit(1);
  }
  console.log(`i18n gate OK (${files.length} files scanned)`);
}
