#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadImpactMap, runDocsImpact } from './lib/docs-impact.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAP = join(ROOT, 'docs/impact-map.json');
const rules = loadImpactMap(MAP).rules;
const run = (args) => execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim();
const fail = (message) => { console.error(`[docs-impact] ${message}`); process.exit(1); };

function checkCommit(commit, changedFiles = null, message = null) {
    const files = changedFiles ?? run(['diff-tree', '--root', '-m', '--first-parent', '--no-commit-id', '--name-only', '-r', commit]).split(/\r?\n/).filter(Boolean);
    const text = message ?? run(['show', '--format=%B', '--no-patch', commit]);
    const result = runDocsImpact({ root: ROOT, changedFiles: files, message: text, rules });
    return { ...result, commit };
}

let results;
if (process.argv.includes('--staged')) {
    const messageFile = process.argv[process.argv.indexOf('--staged') + 1];
    if (!messageFile) fail('--staged requires the commit message file');
    const files = run(['diff', '--cached', '--name-only', '-z']).split('\0').filter(Boolean);
    results = [checkCommit('staged', files, readFileSync(messageFile, 'utf8'))];
} else if (process.argv.includes('--ci')) {
    const baseRef = process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'upstream/main';
    let range;
    try {
        if (process.env.GITHUB_EVENT_NAME === 'pull_request' || process.env.GITHUB_BASE_REF) {
            range = `${run(['merge-base', baseRef, 'HEAD'])}..HEAD`;
        } else if (process.env.GITHUB_EVENT_NAME === 'push' && process.env.GITHUB_EVENT_BEFORE && !/^0+$/.test(process.env.GITHUB_EVENT_BEFORE)) {
            range = `${process.env.GITHUB_EVENT_BEFORE}..HEAD`;
        } else {
            let localBase = baseRef;
            try { run(['rev-parse', '--verify', localBase]); }
            catch { localBase = 'origin/main'; }
            range = `${run(['merge-base', localBase, 'HEAD'])}..HEAD`;
        }
    }
    catch {
        try { range = `${run(['rev-parse', 'HEAD^'])}..HEAD`; }
        catch { fail('cannot determine a commit range to verify'); }
    }
    const commits = run(['rev-list', '--no-merges', '--reverse', range]).split(/\r?\n/).filter(Boolean);
    if (!commits.length) fail('commits-checked=0; no commits found in the CI range');
    results = commits.map((commit) => checkCommit(commit));
} else {
    const messageFile = process.argv[2];
    if (!messageFile) fail('usage: node scripts/check-docs-impact.mjs --staged <message-file> | --ci');
    const files = run(['diff', '--cached', '--name-only', '-z']).split('\0').filter(Boolean);
    results = [checkCommit('staged', files, readFileSync(resolve(messageFile), 'utf8'))];
}

const errors = results.flatMap((result) => result.errors.map((error) => `${result.commit}: ${error}`));
const rulesMatched = results.reduce((total, result) => total + Number(result.summary.match(/rules-matched=(\d+)/)?.[1] ?? 0), 0);
console.log(`[docs-impact] rules-matched=${rulesMatched} commits-checked=${results.length}`);
for (const error of errors) console.error(`[docs-impact] ${error}`);
if (errors.length) process.exit(1);
