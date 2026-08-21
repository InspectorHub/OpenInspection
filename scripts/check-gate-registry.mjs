#!/usr/bin/env node
/**
 * Gate-registry coverage gate.
 *
 * `npm run lint` and `npm run lint:gates-full` no longer enumerate the gates —
 * they run whatever `scripts/lib/gate-registry.mjs` lists. That removed 48 npm
 * spawns and introduced exactly one new failure mode: a `lint:*` script that
 * exists in package.json, appears in no registry, and therefore runs on no
 * rung. It is green forever, and nothing anywhere would say so. The chain had
 * the opposite property by accident — a gate not in the chain was visibly not
 * in the chain, because the chain was the list.
 *
 * So every `lint:*` script must be either REGISTERED (it runs on a rung) or
 * EXCLUDED WITH A REASON in `UNREGISTERED`. An exclusion with no reason is
 * indistinguishable from an oversight, which is why the map's values are prose.
 *
 * Both numbers print on every run, pass or fail. A gate that speaks only when
 * it is angry cannot be checked on the day it is quiet, and this repo has
 * watched exactly that turn a green run into a stable digest of nothing.
 *
 * Usage: node scripts/check-gate-registry.mjs
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCRIPT_GATES, DUP_GATE, UNREGISTERED } from './lib/gate-registry.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scripts = JSON.parse(readFileSync(`${ROOT}/package.json`, 'utf8')).scripts;

const lintScripts = Object.keys(scripts).filter((k) => k.startsWith('lint:'));
const registered = new Set([...SCRIPT_GATES, DUP_GATE].map((g) => g.fix.replace(/^npm run /, '')));

const errors = [];

// Zero of anything here means the reader is broken, not that the repo is clean.
if (lintScripts.length === 0) {
    console.error('gate registry: read ZERO lint:* scripts from package.json — the reader is broken, not the repo.');
    process.exit(1);
}
if (registered.size === 0) {
    console.error('gate registry: the registry lists ZERO gates — an empty list would pass every check below.');
    process.exit(1);
}

const orphans = lintScripts.filter((k) => !registered.has(k) && !UNREGISTERED.has(k));
if (orphans.length) {
    errors.push(
        `${orphans.length} lint:* script(s) run on NO rung and carry no exclusion reason:\n` +
        orphans.map((o) => `    ${o} — register it in scripts/lib/gate-registry.mjs, or add it to UNREGISTERED with the reason`).join('\n'),
    );
}

// The reverse direction. An exclusion outliving its script is a reason nobody
// can evaluate, and it silently inflates the arithmetic below.
const stale = [...UNREGISTERED.keys()].filter((k) => !(k in scripts));
if (stale.length) {
    errors.push(
        `${stale.length} exclusion(s) name a script package.json no longer defines:\n` +
        stale.map((s) => `    ${s} — drop it from UNREGISTERED`).join('\n'),
    );
}

// A registered gate whose npm script was deleted points a human at a command
// that does not exist.
const danglingFix = [...registered].filter((k) => !(k in scripts));
if (danglingFix.length) {
    errors.push(
        `${danglingFix.length} registered gate(s) name a fix command package.json does not define:\n` +
        danglingFix.map((s) => `    ${s}`).join('\n'),
    );
}

const excludedLintScripts = [...UNREGISTERED.keys()].filter((k) => k.startsWith('lint:'));
const accounted = registered.size + excludedLintScripts.length;

if (errors.length) {
    for (const e of errors) console.error(`  ✘ ${e}`);
    console.error(
        `\ngate registry: ${registered.size} registered · ${excludedLintScripts.length} excluded · ` +
        `${lintScripts.length} lint:* scripts in package.json — ${accounted} accounted for.`,
    );
    process.exit(1);
}

console.log(
    `gate registry: ${registered.size} registered · ${excludedLintScripts.length} excluded · ` +
    `${lintScripts.length} lint:* scripts in package.json.`,
);
console.log('  ✓ every lint:* script runs on a rung or is excluded with a reason.');
