#!/usr/bin/env node
/**
 * Every converter that exists is registered, tested, and declared.
 *
 * ── What this answers, and what it does not ─────────────────────────────────
 * PUBLIC gate. It answers "does this converter have a test and a schema" — a
 * question anybody can check from a clone. It says NOTHING about whether the
 * converter has ever been pointed at a real file; that is `verify-real-corpus`,
 * which cannot run here because the files it reads are not in this repository.
 * The two must not be confused: a converter can be thoroughly tested against
 * fixtures somebody invented and still be wrong about every real export, which
 * is precisely the failure the fixture pipeline exists to prevent.
 *
 * Four things are checked, per converter:
 *   1. It is exported and registered — a converter nothing routes to is dead.
 *   2. A spec file imports it.
 *   3. A fixture schema declares its format.
 *   4. That schema declares at least one quirk.
 *
 *   node scripts/check-converter-capability.mjs
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const ADAPTER_DIR = join(root, 'server/lib/migration-intake/adapters');
const SPEC_DIR = join(root, 'tests/unit/migration-intake');
const SCHEMA_DIR = join(root, 'tests/fixtures/intake');
const REGISTRY = join(ADAPTER_DIR, 'registry.ts');

/**
 * Converters, found by their exported symbol rather than by a list kept here.
 *
 * A list would be the thing that goes stale: somebody adds an adapter, forgets
 * the list, and the gate reports full coverage of a set that no longer matches
 * the directory. Reading the directory means a new converter is in scope the
 * moment it exists.
 */
function converters() {
  if (!existsSync(ADAPTER_DIR)) return [];
  const out = [];
  for (const file of readdirSync(ADAPTER_DIR)) {
    if (!file.endsWith('.ts')) continue;
    const source = readFileSync(join(ADAPTER_DIR, file), 'utf8');
    for (const match of source.matchAll(/export const (\w*[aA]dapter)\s*:\s*MigrationAdapter/g)) {
      const vendor = source.match(
        new RegExp(`export const ${match[1]}[\\s\\S]{0,400}?vendor:\\s*'([^']+)'`),
      );
      out.push({ symbol: match[1], file, vendor: vendor ? vendor[1] : null });
    }
  }
  return out;
}

const specs = existsSync(SPEC_DIR)
  ? readdirSync(SPEC_DIR)
    .filter((f) => f.endsWith('.spec.ts'))
    .map((f) => ({ name: f, source: readFileSync(join(SPEC_DIR, f), 'utf8') }))
  : [];

const registrySource = existsSync(REGISTRY) ? readFileSync(REGISTRY, 'utf8') : '';
const found = converters();
const failures = [];
const rows = [];

for (const converter of found) {
  const problems = [];
  if (converter.vendor === null) {
    problems.push('declares no vendor');
  } else if (!new RegExp(`\\b${converter.vendor}\\s*:`).test(registrySource)) {
    problems.push(`is not registered under "${converter.vendor}" in registry.ts`);
  }
  const testedBy = specs.filter((s) => s.source.includes(converter.symbol)).map((s) => s.name);
  if (testedBy.length === 0) problems.push('has no spec that imports it');

  const schema = converter.vendor ? join(SCHEMA_DIR, `${converter.vendor}.schema.json`) : null;
  if (converter.symbol === 'csvGenericAdapter') {
    // The one converter with no fixture schema, and it is a fact about the
    // format rather than an omission: a comma-separated file has no container
    // and no quirks to declare, and nothing about it was reverse-engineered
    // from anybody's export. Named here rather than silently skipped.
    rows.push(`  · ${converter.symbol} (${converter.vendor}) — tested by ${testedBy.join(', ') || 'nothing'}`
      + '; SKIPPED schema check: a plain spreadsheet has no format to declare.');
  } else if (!schema || !existsSync(schema)) {
    problems.push(`has no fixture schema at tests/fixtures/intake/${converter.vendor}.schema.json`);
  } else {
    const quirks = JSON.parse(readFileSync(schema, 'utf8')).quirks ?? [];
    if (quirks.length === 0) problems.push('has a fixture schema declaring no quirks');
    rows.push(`  · ${converter.symbol} (${converter.vendor}) — tested by ${testedBy.join(', ')}`
      + `; ${quirks.length} declared quirk(s)`);
  }

  for (const problem of problems) failures.push(`  ✘ ${converter.symbol} (${converter.file}) ${problem}.`);
}

// Both numbers, side by side. A gate that prints only "pass" cannot be checked
// on the day it passes because it looked at nothing.
console.log(`Converter capability — ${found.length} converter(s) found in `
  + `server/lib/migration-intake/adapters, ${specs.length} spec file(s) in scope.`);
for (const row of rows) console.log(row);
console.log(`  ${found.length - failures.length >= 0 ? found.length : 0} checked · `
  + `${failures.length} failing check(s)`);

if (found.length === 0) {
  console.log('✘ Found 0 converters. This repository has adapters, so the matcher is broken');
  console.log('  or the directory moved. A zero here is a failure, never a pass.');
  process.exit(1);
}

if (failures.length) {
  console.log(`\n✘ Converter-capability gate — ${failures.length} problem(s):`);
  console.log(failures.join('\n'));
  console.log('\n  A converter with no test is a claim. A converter with no declared format');
  console.log('  cannot have a generated fixture, and cannot be checked against a real file.');
  process.exit(1);
}

console.log('✅ Converter-capability gate — every converter is registered, tested and declared.');
console.log('   ⚠️ This says nothing about whether any of them has seen a real file.');
console.log('      That is `npm run verify:real-corpus`, which never runs in CI.');
process.exit(0);
