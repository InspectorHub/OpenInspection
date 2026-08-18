/**
 * Invariants for the conformance-gate registry.
 *
 * The registry is the only place that says which gates exist and which rung
 * runs them, so a typo here is a gate that silently never runs. These tests
 * are the reason a typo cannot be silent.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { pathToFileURL } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

type Gate = { key: string; label: string; script?: string; fix: string; rung: string; args?: string[] };

let SCRIPT_GATES: Gate[];
let DUP_GATE: Gate;
let UNREGISTERED: Map<string, string>;
let PRECOMMIT: string;
let PUSH: string;
let scripts: Record<string, string>;
let ROOT: string;

beforeAll(async () => {
    // Resolved from cwd and then ASSERTED. The relative-from-`import.meta.dirname`
    // form this was drafted with resolved to `D:\` under vitest, and the only
    // symptom was `Cannot find module D:\scripts\lib\gate-registry.mjs` — a
    // wrong root wearing the costume of a missing file. Checking for
    // package.json makes the root itself the thing that fails.
    ROOT = process.cwd();
    expect(
        existsSync(path.join(ROOT, 'package.json')),
        `ROOT resolved to ${ROOT}, which has no package.json — the suite is not running from the repo root`,
    ).toBe(true);
    const url = pathToFileURL(path.join(ROOT, 'scripts/lib/gate-registry.mjs')).href;
    // @vite-ignore — load the .mjs natively; vitest's transform cannot process it.
    ({ SCRIPT_GATES, DUP_GATE, UNREGISTERED, PRECOMMIT, PUSH } = await import(/* @vite-ignore */ url));
    scripts = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts;
});

describe('gate registry', () => {
    it('gives every gate a known rung', () => {
        for (const g of [...SCRIPT_GATES, DUP_GATE]) {
            expect([PRECOMMIT, PUSH], `${g.key} has rung "${g.rung}"`).toContain(g.rung);
        }
    });

    it('has unique keys', () => {
        const keys = [...SCRIPT_GATES, DUP_GATE].map((g) => g.key);
        expect(keys.length, `duplicate key in ${keys.join(',')}`).toBe(new Set(keys).size);
    });

    it('points every gate at a script file that exists', () => {
        for (const g of SCRIPT_GATES) {
            expect(existsSync(path.join(ROOT, 'scripts', g.script!)), `missing scripts/${g.script}`).toBe(true);
        }
    });

    it('points every gate fix at a real npm script', () => {
        for (const g of [...SCRIPT_GATES, DUP_GATE]) {
            const name = g.fix.replace(/^npm run /, '');
            expect(scripts[name], `${g.key}.fix names "${name}", which package.json does not define`).toBeDefined();
        }
    });

    it('keeps the precommit rung to exactly the gates pre-commit ran before consolidation', () => {
        // Locked deliberately: pre-commit is the fastest rung and the one every
        // commit pays. Adding a gate here is a cost decision, so it has to be
        // made by editing this list, not by forgetting to set a rung.
        const EXPECTED_PRECOMMIT = [
            'ds', 'contrast', 'svg', 'migrefs', 'filesize', 'tz', 'idempotency',
            'extcollide', 'price', 'zerotrack', 'aiclass', 'teststsconfig',
            'submitguard', 'seedsql', 'dup',
        ].sort();
        const actual = [...SCRIPT_GATES, DUP_GATE].filter((g) => g.rung === PRECOMMIT).map((g) => g.key).sort();
        expect(actual).toEqual(EXPECTED_PRECOMMIT);
    });

    it('carries a reason for every npm script it deliberately does NOT register', () => {
        // An exclusion with no reason is indistinguishable from an oversight,
        // and this map is the only thing standing between "we chose not to run
        // it" and "nobody noticed it stopped running".
        expect(UNREGISTERED.size, 'no exclusions recorded — the map exists to be non-empty').toBeGreaterThan(0);
        for (const [name, reason] of UNREGISTERED) {
            expect(scripts[name], `UNREGISTERED names "${name}", which package.json does not define`).toBeDefined();
            expect(String(reason).trim().length, `${name} is excluded with an empty reason`).toBeGreaterThan(10);
        }
    });
});
