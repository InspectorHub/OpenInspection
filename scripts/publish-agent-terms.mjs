/**
 * Publish the deployment's agent terms.
 *
 * `POST /api/agent-signup` refuses while nothing is published, which is the round
 * 24c gate: a deployment that has not published a document written for agents
 * cannot take an agent's agreement to one. This script is the only way out of that
 * state, and it is deliberately hard to run by accident.
 *
 * ── What it refuses, and why each refusal exists ────────────────────────────
 *  - A body still containing a `{{PLACEHOLDER}}`. Counsel round 29 ruled that
 *    `{{GOVERNING_LAW}}` must not survive to publication, and governing law is not
 *    the only one: a liability cap of `{{LIABILITY_FLOOR}}` is worse than no cap
 *    because it reads as a term. This check is what makes that ruling mechanical
 *    instead of remembered.
 *  - A body whose status line still says draft. The document carries its own
 *    review state, and publishing a file that says it is not published is a
 *    contradiction no reviewer would sign off.
 *  - A missing or malformed `--version`. The version is the date a reader is shown
 *    and it goes on every acceptance; deriving it from today's clock would stamp
 *    the deploy date onto a document counsel approved on another day.
 *
 * ── What it strips ──────────────────────────────────────────────────────────
 * HTML comments. The file carries the review status and the counsel decision
 * points inline so they travel with the text under review — and none of that is
 * part of the agreement. Publishing them would put our open questions in front of
 * the signer. The stripped body is what gets hashed, so the hash is of exactly
 * what a signer sees.
 *
 * Idempotent on the CONTENT HASH, not the version: the same words published twice
 * return the existing version. A changed body under an already-published version
 * string is refused by the service — a version people accepted cannot come to mean
 * different words.
 */

import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'app', 'content', 'legal', 'agent-terms.md');
const DOC = 'agent_terms';

const argv = process.argv.slice(2);
const remote = argv.includes('--remote');
const versionIdx = argv.indexOf('--version');
const version = versionIdx >= 0 ? argv[versionIdx + 1] : undefined;

const die = (msg) => { console.error(`\n✘ ${msg}\n`); process.exit(1); };

if (!version || !/^\d{4}-\d{2}-\d{2}$/.test(version)) {
    die('--version YYYY-MM-DD is required (the date counsel approved the text, not today).');
}

const raw = readFileSync(SOURCE, 'utf8');

// Strip HTML comments FIRST, so the checks below run against what a signer sees.
// The draft banner and the decision points live in comments precisely so they are
// reviewable without being publishable, and a placeholder mentioned inside a
// comment must not block a body that no longer contains one.
const body = raw.replace(/<!--[\s\S]*?-->/g, '').replace(/\n{3,}/g, '\n\n').trim();

const placeholders = [...new Set([...body.matchAll(/\{\{([A-Z_]+)\}\}/g)].map((m) => m[1]))];
const statusLine = body.split('\n').find((l) => /^\*\*Status:\*\*/.test(l)) ?? '(no status line)';
const draftish = /draft|not published|unpublished|do not publish/i.test(statusLine);

// Both numbers, every run. A gate that prints only its verdict cannot be checked
// on the day it goes green.
console.log(`\nagent terms — ${SOURCE.replace(ROOT, '.')}`);
console.log(`  target              : ${remote ? 'REMOTE' : 'local'}`);
console.log(`  version requested   : ${version}`);
console.log(`  body length         : ${body.length} chars (${raw.length} before stripping comments)`);
console.log(`  placeholders left   : ${placeholders.length}${placeholders.length ? ` — ${placeholders.join(', ')}` : ''}`);
console.log(`  status line         : ${statusLine}`);

if (placeholders.length > 0) {
    die(`The body still contains ${placeholders.length} unresolved placeholder(s): ${placeholders.join(', ')}.\n`
      + '  Counsel round 29: governing law must not ship as a placeholder, and a liability\n'
      + '  cap that reads as a term while naming no figure is worse than none. Fill them in\n'
      + '  (per deployment) and publish again.');
}
if (draftish) {
    die('The status line still marks this as a draft.\n'
      + '  Publishing a document that says it is not published is a contradiction, so the\n'
      + '  file has to be updated to a published status by whoever approved it.');
}

const contentHash = createHash('sha256').update(body, 'utf8').digest('hex');
console.log(`  content hash        : ${contentHash.slice(0, 16)}…`);

const sq = (s) => s.replace(/'/g, "''");
const sqlFile = join(ROOT, `.agent-terms-publish-${process.pid}.sql`);

const run = (sql) => {
    writeFileSync(sqlFile, sql, 'utf8');
    try {
        return execFileSync('node', [
            join(ROOT, 'scripts', 'wrangler.mjs'), 'd1', 'execute', 'DB',
            remote ? '--remote' : '--local', '--json', '--file', sqlFile, '--yes',
        ], { cwd: ROOT, encoding: 'utf8' });
    } finally {
        rmSync(sqlFile, { force: true });
    }
};

// Already published, byte-identical? Say so and stop rather than minting a second
// version a reader would have to diff to discover is the same document.
const existing = run(
    `SELECT version, content_hash FROM deployment_legal_versions `
    + `WHERE doc = '${DOC}' ORDER BY published_at DESC;`,
);
const rows = (() => {
    const i = existing.indexOf('[');
    if (i < 0) return [];
    try { return JSON.parse(existing.slice(i))[0]?.results ?? []; } catch { return []; }
})();
console.log(`  already published   : ${rows.length} version(s)`);

const same = rows.find((r) => r.content_hash === contentHash);
if (same) {
    console.log(`\n= ${DOC} ${same.version} is already published with this exact text — nothing to do.\n`);
    process.exit(0);
}
const clash = rows.find((r) => r.version === version);
if (clash) {
    die(`${DOC} ${version} is already published with DIFFERENT text (${clash.content_hash.slice(0, 12)}…).\n`
      + '  A version people have accepted cannot be edited. Publish a new version instead.');
}

run(
    `INSERT INTO deployment_legal_versions `
    + `(id, doc, version, body_snapshot, content_hash, published_at) VALUES `
    + `('${randomUUID()}', '${DOC}', '${sq(version)}', '${sq(body)}', '${contentHash}', ${Date.now()});`,
);

console.log(`\n✓ published ${DOC} ${version} hash=${contentHash.slice(0, 12)}… [${remote ? 'remote' : 'local'}]`);
console.log('  Agent signup is now open on this deployment.\n');
