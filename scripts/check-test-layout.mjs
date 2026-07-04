#!/usr/bin/env node
/**
 * Test-layout gate (R1/R4/R6/R8 of the 2026-07 tests reorg).
 *  - no .spec.ts directly under tests/ or tests/web/ (directory = suite)
 *  - no .spec.ts directly under tests/unit/ (must live in a domain dir)
 *  - E2E is the single tests/e2e/ — tests/web/unit, tests/web/e2e, tests/integration must not exist
 *  - every playwright.config.ts project testMatch resolves to a file in tests/e2e
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const errors = [];
const specsAt = (dir) =>
    existsSync(join(root, dir))
        ? readdirSync(join(root, dir)).filter((f) => /\.spec\.tsx?$/.test(f))
        : [];

for (const f of specsAt('tests')) errors.push(`tests/${f} — specs must live in a suite dir (R1)`);
for (const f of specsAt('tests/web')) errors.push(`tests/web/${f} — retired; E2E lives in tests/e2e (R1/R8)`);
for (const f of specsAt('tests/unit')) errors.push(`tests/unit/${f} — move into a domain dir (R4)`);
for (const dead of ['tests/web/unit', 'tests/web/e2e', 'tests/integration']) {
    if (existsSync(join(root, dead)))
        errors.push(`${dead}/ exists — retired (frontend co-locates under app/; E2E is the single tests/e2e/) (R2/R8)`);
}

const cfg = readFileSync(join(root, 'playwright.config.ts'), 'utf8');
// plain and ternary testMatch string literals must resolve under tests/e2e:
for (const m of cfg.matchAll(/'([^']+\.spec\.ts)'/g)) {
    const f = m[1];
    if (f.includes('*')) continue; // glob testMatch (e.g. **/*.integration.spec.ts) — not a literal file
    if (f.endsWith('.never.ts')) continue; // intentional zero-match sentinel
    if (!existsSync(join(root, 'tests/e2e', f)))
        errors.push(`playwright.config.ts testMatch '${f}' resolves to no file in tests/e2e (R6)`);
}

if (errors.length) {
    console.error('Test layout violations:\n  ' + errors.join('\n  '));
    process.exit(1);
}
console.log('test layout OK');
