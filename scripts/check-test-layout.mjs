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
const RETIRED_DIRS = ['tests/web/unit', 'tests/web/e2e', 'tests/integration'];
for (const dead of RETIRED_DIRS) {
    if (existsSync(join(root, dead)))
        errors.push(`${dead}/ exists — retired (frontend co-locates under app/; E2E is the single tests/e2e/) (R2/R8)`);
}

// Contract suite: same "directory = suite" rule as tests/unit — a spec names
// the third party whose contract it checks, so it lives in tests/contract/<party>/.
for (const f of specsAt('tests/contract'))
    errors.push(`tests/contract/${f} — move into a per-party dir, e.g. tests/contract/qbo/ (R4)`);

// And the suffix has to match the config that collects it. A contract spec
// named `*.spec.ts` is collected by NOTHING (vitest.contract.config.ts includes
// only `*.contract.spec.ts`), which is a spec file that exists, passes review,
// and never runs.
const CONTRACT_DIR = 'tests/contract';
let contractSpecCount = 0;
if (existsSync(join(root, CONTRACT_DIR))) {
    for (const party of readdirSync(join(root, CONTRACT_DIR), { withFileTypes: true })) {
        if (!party.isDirectory()) continue;
        for (const f of readdirSync(join(root, CONTRACT_DIR, party.name))) {
            if (!/\.spec\.tsx?$/.test(f)) continue;
            contractSpecCount++;
            if (!/\.(contract|live)\.spec\.ts$/.test(f))
                errors.push(
                    `${CONTRACT_DIR}/${party.name}/${f} — must end .contract.spec.ts (offline, runs in CI) ` +
                    'or .live.spec.ts (needs sandbox credentials); no other suffix is collected',
                );
        }
    }
}

const cfg = readFileSync(join(root, 'playwright.config.ts'), 'utf8');
// plain and ternary testMatch string literals must resolve under tests/e2e:
let testMatchEntries = 0;
for (const m of cfg.matchAll(/'([^']+\.spec\.ts)'/g)) {
    const f = m[1];
    if (f.includes('*')) continue; // glob testMatch (e.g. **/*.integration.spec.ts) — not a literal file
    if (f.endsWith('.never.ts')) continue; // intentional zero-match sentinel
    testMatchEntries++;
    if (!existsSync(join(root, 'tests/e2e', f)))
        errors.push(`playwright.config.ts testMatch '${f}' resolves to no file in tests/e2e (R6)`);
}

const e2eSpecCount = existsSync(join(root, 'tests/e2e'))
    ? readdirSync(join(root, 'tests/e2e')).filter((f) => /\.spec\.ts$/.test(f)).length
    : 0;

// A gate that walked nothing would pass forever. It has no business being
// green when it cannot see the thing it claims to check.
if (testMatchEntries === 0 || e2eSpecCount === 0 || contractSpecCount === 0) {
    console.error(
        `Test-layout gate: found ${testMatchEntries} literal testMatch entr(ies) in playwright.config.ts, ` +
        `${e2eSpecCount} spec file(s) in tests/e2e and ${contractSpecCount} in tests/contract — ` +
        'a config or a directory is wrong, or the walk is broken. Refusing to report OK.',
    );
    process.exit(1);
}

if (errors.length) {
    console.error('Test layout violations:\n  ' + errors.join('\n  '));
    process.exit(1);
}
console.log(
    `test layout OK (${testMatchEntries} testMatch entries resolved against ${e2eSpecCount} tests/e2e spec files, ` +
    `${contractSpecCount} tests/contract spec files, ${RETIRED_DIRS.length} retired-dir checks)`,
);
