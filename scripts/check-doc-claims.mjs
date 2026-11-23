#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { baselineDoesNotRise, buildSuffixSet, extractClaims, resolveClaims } from './lib/doc-claims.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = join(ROOT, 'scripts/doc-claims-baseline.json');
const tracked = execFileSync('git', ['-C', ROOT, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0').filter(Boolean);
const docs = tracked.filter((file) => file.toLowerCase().endsWith('.md'));
const suffixSet = buildSuffixSet(tracked);
const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const scripts = new Set(Object.keys(packageJson.scripts ?? {}));
const packageScriptCache = new Map();
function packageScriptsAt(directory) {
    if (!packageScriptCache.has(directory)) {
        const packageFile = join(directory, 'package.json');
        let packageScripts = null;
        if (existsSync(packageFile)) {
            try {
                const realRoot = realpathSync(ROOT);
                const realPackage = realpathSync(packageFile);
                const relativePackage = relative(realRoot, realPackage);
                if (!isAbsolute(relativePackage) && relativePackage !== '..' && !relativePackage.startsWith(`..${sep}`)) {
                    packageScripts = new Set(Object.keys(JSON.parse(readFileSync(realPackage, 'utf8')).scripts ?? {}));
                }
            }
            catch { packageScripts = null; }
        }
        packageScriptCache.set(directory, packageScripts);
    }
    return packageScriptCache.get(directory);
}
const dead = [];
let claimsChecked = 0;

for (const file of docs) {
    const claims = extractClaims(readFileSync(join(ROOT, file), 'utf8'));
    claimsChecked += claims.length;
    for (const result of resolveClaims(claims, { trackedFiles: tracked, scripts, repoRoot: ROOT, packageScriptsAt, docFile: file, suffixSet })) {
        if (!result.ok) dead.push({ file, claim: result.claim });
    }
}

let baseline;
try { baseline = JSON.parse(readFileSync(BASELINE, 'utf8')); }
catch (error) {
    console.error(`[doc-claims] cannot read numeric baseline: ${error.message}`);
    process.exit(1);
}
const errors = [];
if (docs.length === 0) errors.push('examined=0; tracked Markdown documentation was not found');
let previousBaseline = null;
const baselineRefs = process.env.GITHUB_BASE_REF
    ? [`origin/${process.env.GITHUB_BASE_REF}`]
    : process.env.GITHUB_EVENT_BEFORE && !/^0+$/.test(process.env.GITHUB_EVENT_BEFORE)
        ? [process.env.GITHUB_EVENT_BEFORE]
        : ['upstream/main', 'origin/main', 'HEAD^'];
for (const ref of baselineRefs) {
    try {
        previousBaseline = JSON.parse(execFileSync('git', ['-C', ROOT, 'show', `${ref}:scripts/doc-claims-baseline.json`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).deadClaims;
        break;
    } catch { /* Try the next base ref; the baseline may not exist on the target branch yet. */ }
}
if (process.argv.includes('--update')) {
    if (!baselineDoesNotRise(dead.length, previousBaseline)) errors.push(`refusing to raise dead-claim baseline from ${previousBaseline} to ${dead.length}`);
    else {
        baseline = { deadClaims: dead.length };
        writeFileSync(BASELINE, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
    }
} else if (!baselineDoesNotRise(baseline.deadClaims, previousBaseline)) {
    errors.push(`baseline deadClaims must be a non-negative integer and may not rise above ${previousBaseline}`);
} else if (dead.length > baseline.deadClaims) {
    errors.push(`dead claims rose from baseline ${baseline.deadClaims} to ${dead.length}`);
}

console.log(`[doc-claims] documents examined=${docs.length} claims checked=${claimsChecked} dead found=${dead.length} baseline=${baseline.deadClaims}`);
for (const item of dead.slice(0, 40)) console.error(`  ${item.file}:${item.claim.line}: ${item.claim.value} (${item.claim.kind})`);
if (dead.length > 40) console.error(`  ... ${dead.length - 40} more`);
for (const error of errors) console.error(`[doc-claims] ${error}`);
if (errors.length) process.exit(1);
