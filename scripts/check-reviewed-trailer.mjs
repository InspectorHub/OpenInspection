#!/usr/bin/env node
/**
 * Reviewed-trailer gate (commit-msg rung).
 *
 * Fails (exit 1) when a commit stages any code or configuration file and its
 * message carries neither a valid `Reviewed:` line nor a `review-allow:` line.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS GATE CANNOT DO
 * ---------------------------------------------------------------------------
 * It cannot verify that a review happened. A line of text satisfies it, exactly
 * as a `Chrome:` line satisfies the chrome-record gate. Nothing a commit-msg
 * hook can read distinguishes a diff somebody else read from one nobody read.
 * Do not cite a green run as evidence of a review; cite the review.
 *
 * What it does is give the record a fixed place and shape, and make a MISSING
 * one loud at the one moment when going back is still cheap.
 *
 * ---------------------------------------------------------------------------
 * THE RULE
 * ---------------------------------------------------------------------------
 * Every commit that changes code needs an independent, read-only review of the
 * uncommitted diff first. The message records it, below the subject line:
 *
 *     Reviewed: <who or what reviewed it, and the verdict>
 *
 * The text must be at least MIN_REVIEWED_CHARS characters, at least
 * MIN_REVIEWED_WORDS words, and carry a verdict token, case-sensitive: `PASS`
 * or `PASS WITH FIXES`. A line that only says FAIL does not count: a failed
 * review is not a record that the code may be committed. A `Reviewed:` on the
 * subject (first) line is rejected. One or more lines are fine (a second pass
 * gets its own line); every line is judged.
 *
 * AMEND LIMITATION: `git commit --amend --no-edit` carries the old message, and
 * so the old record, over new content. The gate cannot see that. After changing
 * content in an amend, re-run the review and rewrite the line. (Binding the
 * record to a hash of the diff was considered and deliberately not required.)
 *
 * ESCAPE: `review-allow: <reason>` (>= MIN_ALLOW_CHARS characters, >= 2 words)
 * for a commit that genuinely cannot be reviewed first. The reason is prose, a
 * bare skip is indistinguishable from an oversight, and escapes are counted and
 * printed on every run. One marker excuses the whole commit.
 *
 * ---------------------------------------------------------------------------
 * WHAT NEEDS REVIEW, AND WHAT IS EXEMPT
 * ---------------------------------------------------------------------------
 * Exempt (documentation): Markdown files anywhere, except CLAUDE.md and
 * AGENTS.md (agent instructions are behaviour), and files under `docs/` with a
 * prose or media extension (md, mdx, txt, png, jpg, jpeg, svg, gif, webp).
 * Everything else is CODE: anything under `.claude/`, every other extension
 * under `docs/` (json, html, py, tsv, ...), symlinks (mode 120000), JSON, YAML,
 * scripts, hooks, workflows, i18n catalogs.
 * Submodule pointers (mode 160000) listed in `scripts/reviewed-trailer.config.json`
 * (`{ "gatedSubmodules": [...] }`) are exempt: the review belongs to the commit
 * inside that submodule. Any other gitlink is CODE. A missing config file means
 * an empty list (the strict side); an unreadable or malformed one is an error and
 * the gate fails closed.
 *
 * Exempt by message, and the skip is printed: `fixup! `, `squash! `, `amend! `
 * subjects, a merge in progress (MERGE_HEAD), and a `Revert "` subject while
 * REVERT_HEAD exists. A subject alone never exempts a merge or a revert; git has
 * to be in that state. CHERRY_PICK_HEAD exempts nothing: a cherry-pick writes a
 * new commit, so its message must carry its own record.
 *
 * An empty staged list fails closed (it is either `--allow-empty`, an amend
 * that restages nothing, or a broken reader); say `review-allow: <reason>`.
 *
 * USAGE
 *   node scripts/check-reviewed-trailer.mjs <path-to-COMMIT_EDITMSG>
 *   node scripts/check-reviewed-trailer.mjs --report-only --range <rev-range>
 *       Counts how many commits in the range WOULD fail. Always exits 0.
 *       The hook never passes --report-only; there is no environment switch.
 */
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const MIN_REVIEWED_CHARS = 20;
export const MIN_REVIEWED_WORDS = 3;
export const MIN_ALLOW_CHARS = 15;
export const MIN_ALLOW_WORDS = 2;

const REVIEWED_RE = /^[ \t]*Reviewed:[ \t]*(.*)$/i;
const ALLOW_RE = /^[ \t]*review-allow:[ \t]*(.*)$/i;
const VERDICT_RE = /\bPASS\b/; // matches `PASS` and `PASS WITH FIXES`; case-sensitive on purpose

const CONFIG_PATH = resolve(dirname(fileURLToPath(import.meta.url)), 'reviewed-trailer.config.json');

/** Validates the config text. Throws on anything but `{ "gatedSubmodules": string[] }`. */
export function parseConfig(text) {
    let cfg;
    try { cfg = JSON.parse(text); } catch (e) { throw new Error(`invalid JSON (${e.message})`, { cause: e }); }
    if (!cfg || typeof cfg !== 'object' || !Array.isArray(cfg.gatedSubmodules) || !cfg.gatedSubmodules.every((s) => typeof s === 'string' && s !== '')) {
        throw new Error('expected { "gatedSubmodules": [non-empty strings] }');
    }
    return cfg.gatedSubmodules;
}

/** Missing file = no exempt submodules (strict). Malformed file throws. */
export function loadGatedSubmodules(path = CONFIG_PATH) {
    if (!existsSync(path)) return [];
    return parseConfig(readFileSync(path, 'utf8'));
}
const DOC_EXTENSIONS = /\.(?:md|mdx|txt|png|jpg|jpeg|svg|gif|webp)$/i;

const words = (s) => s.split(/\s+/).filter(Boolean).length;

/** Body lines without the comment block git removes AFTER the hook runs. */
function bodyLines(message) {
    return message.split(/\r?\n/).filter((l) => !/^[ \t]*#/.test(l));
}

/** entries: string paths or {path, gitlink?, symlink?}. True when the entry is documentation. */
export function isDocEntry(e, gated = []) {
    const p = typeof e === 'string' ? e : e.path;
    if (typeof e !== 'string') {
        if (e.symlink) return false;
        if (e.gitlink) return gated.includes(p);
    }
    if (p.startsWith('.claude/') || /(^|\/)(?:CLAUDE|AGENTS)\.md$/i.test(p)) return false;
    if (/\.md$/i.test(p)) return true;
    return p.startsWith('docs/') && DOC_EXTENSIONS.test(p);
}

export const isDocsOnly = (entries, gated = []) => entries.every((e) => isDocEntry(e, gated));

/** @param {{merge?: boolean, revert?: boolean}} state git states read from the repository */
export function exemptReason(message, { merge = false, revert = false } = {}) {
    if (merge) return 'merge commit (MERGE_HEAD)';
    const subject = bodyLines(message).find((l) => l.trim() !== '') ?? '';
    if (revert && /^Revert "/.test(subject)) return 'git revert in progress (REVERT_HEAD)';
    if (/^(?:fixup|squash|amend)! /.test(subject)) return 'fixup/squash commit, the record belongs in the commit it folds into';
    return null;
}

export function parseMessage(message) {
    const lines = bodyLines(message);
    const subjectIdx = lines.findIndex((l) => l.trim() !== '');
    const reviews = [];
    const malformed = [];
    const allows = [];
    const badAllows = [];
    lines.forEach((line, i) => {
        const r = REVIEWED_RE.exec(line);
        if (r) {
            const text = r[1].trim();
            const raw = line.trim();
            if (i === subjectIdx) malformed.push({ raw, why: 'a Reviewed line cannot be the subject line; put it below the subject' });
            else if (text.length < MIN_REVIEWED_CHARS || words(text) < MIN_REVIEWED_WORDS) {
                malformed.push({ raw, why: `\`${text}\` is too thin (needs >= ${MIN_REVIEWED_CHARS} chars and >= ${MIN_REVIEWED_WORDS} words)` });
            } else if (!VERDICT_RE.test(text)) {
                malformed.push({ raw, why: `\`${text}\` carries no verdict: say PASS or PASS WITH FIXES (a FAIL is not a record that the commit may go in)` });
            } else reviews.push({ text, raw });
            return;
        }
        const a = ALLOW_RE.exec(line);
        if (a) {
            const reason = a[1].trim();
            if (reason.length < MIN_ALLOW_CHARS || words(reason) < MIN_ALLOW_WORDS) {
                badAllows.push({ raw: line.trim(), why: `reason \`${reason}\` is too thin (needs >= ${MIN_ALLOW_CHARS} chars and >= ${MIN_ALLOW_WORDS} words)` });
            } else allows.push({ reason, raw: line.trim() });
        }
    });
    return { reviews, malformed, allows, badAllows };
}

/** @returns {{ok: boolean, exempt: string|null, kind: string|null, counts: object, problems: string[]}} */
export function evaluate({ entries, message, merge = false, revert = false, cherryPick = false, gatedSubmodules = [] }) {
    const parsed = parseMessage(message);
    const docsOnly = entries.length > 0 && isDocsOnly(entries, gatedSubmodules);
    const counts = {
        staged: entries.length,
        code: entries.filter((e) => !isDocEntry(e, gatedSubmodules)).length,
        reviews: parsed.reviews.length,
        malformed: parsed.malformed.length,
        allows: parsed.allows.length,
        badAllows: parsed.badAllows.length,
    };
    const exempt = exemptReason(message, { merge, revert });
    if (exempt) return { ok: true, exempt, kind: null, counts, problems: [], parsed };

    const problems = [];
    let kind = null;
    // A malformed record is louder than a missing one, and counts even on a docs-only commit.
    for (const m of parsed.malformed) problems.push(`malformed Reviewed line, ${m.why}\n      ${m.raw}`);
    for (const b of parsed.badAllows) problems.push(`malformed review-allow, ${b.why}\n      ${b.raw}`);
    if (problems.length) kind = 'malformed';

    if (entries.length === 0) {
        if (counts.allows === 0) {
            problems.push('ZERO staged files: fails closed (empty commit, amend that restages nothing, or a broken reader). Say `review-allow: <reason>`.');
            kind = 'empty';
        }
    } else if (!docsOnly && counts.reviews === 0 && counts.allows === 0) {
        problems.push(`${counts.code} code/config file(s) staged and the message carries no valid Reviewed line and no review-allow.`);
        kind = 'missing';
    }
    if (cherryPick && problems.length) {
        problems.push('This is a cherry-pick: the new commit needs its own record. Review it, or say `review-allow: cherry-picked from <sha>, reviewed there`.');
    }
    return { ok: problems.length === 0, exempt: null, kind, counts, problems, parsed };
}

function printCounts(c, verdict) {
    console.log(
        `reviewed-trailer: staged ${c.staged} | code/config ${c.code} | Reviewed ${c.reviews} (malformed ${c.malformed}) ` +
            `| review-allow ${c.allows} (malformed ${c.badAllows}) -> ${verdict}`,
    );
}

function printFailure(result) {
    console.error('\nReviewed-trailer check FAILED.\n');
    if (result.kind === 'missing') console.error('This commit changes code or configuration and the message does not say an independent review read the diff first.\n');
    else if (result.kind === 'empty') console.error('Nothing is staged, so this gate cannot tell what the commit changes.\n');
    else console.error('The message has a malformed review record (see below); a malformed record is never accepted.\n');
    for (const p of result.problems) console.error(`  x ${p}`);
    console.error('\n  Have a separate read-only reviewer read the uncommitted diff, then add one line below the subject:\n');
    console.error('      Reviewed: independent read-only review of the staged diff, PASS WITH FIXES (fixes applied)');
    console.error(`\n  At least ${MIN_REVIEWED_CHARS} characters and ${MIN_REVIEWED_WORDS} words: who or what reviewed it, and the verdict (PASS or PASS WITH FIXES).`);
    console.error('  If the commit genuinely cannot be reviewed first, say so with a reason, never a bare skip:\n');
    console.error('      review-allow: emergency revert of a broken deploy, reviewed after the fact');
    console.error(`\n  (reason: at least ${MIN_ALLOW_CHARS} characters and ${MIN_ALLOW_WORDS} words.)`);
    console.error('  Documentation-only commits (Markdown, prose and images under docs/) are exempt. This gate cannot tell whether a review happened.');
}

function git(args) {
    const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (r.error || r.status !== 0) return { ok: false, why: (r.stderr || r.error?.message || `git ${args[0]} exited ${r.status}`).trim() };
    return { ok: true, out: r.stdout };
}

/** `git diff --raw -z` pairs: ":<srcmode> <dstmode> ... <status>\0<path>\0" */
export function parseRaw(out) {
    const parts = out.split('\0');
    const entries = [];
    for (let i = 0; i + 1 < parts.length; i += 2) {
        if (!parts[i].startsWith(':')) { i--; continue; }
        const modes = parts[i].slice(1).split(' ');
        entries.push({
            path: parts[i + 1],
            gitlink: modes[0] === '160000' || modes[1] === '160000',
            symlink: modes[0] === '120000' || modes[1] === '120000',
        });
    }
    return entries;
}

function readStaged() {
    const r = git(['diff', '--cached', '--raw', '-z', '--no-renames', '--no-ext-diff', '--diff-filter=ACMRTD']);
    return r.ok ? { entries: parseRaw(r.out) } : { error: `could not read the staged files: ${r.why}` };
}

function reportRange(range) {
    const log = git(['log', '--format=%H', '--no-merges', range]);
    if (!log.ok) { console.error(`reviewed-trailer: could not read range ${range}: ${log.why}`); process.exit(1); }
    const shas = log.out.split(/\r?\n/).filter(Boolean);
    if (shas.length === 0) { console.error(`reviewed-trailer: range ${range} holds ZERO commits. Refusing to report a measurement of nothing.`); process.exit(1); }
    let gatedSubmodules;
    try { gatedSubmodules = loadGatedSubmodules(); } catch (e) { console.error(`reviewed-trailer: config unusable: ${e.message}`); process.exit(1); }
    let wouldFail = 0;
    for (const sha of shas) {
        const files = git(['diff-tree', '--no-commit-id', '--raw', '-z', '-r', '--no-renames', sha]);
        const msg = git(['log', '-1', '--format=%B', sha]);
        if (!files.ok || !msg.ok) { console.error(`  ! ${sha.slice(0, 8)} unreadable`); process.exit(1); }
        const r = evaluate({ entries: parseRaw(files.out), message: msg.out, gatedSubmodules });
        if (!r.ok) wouldFail++;
        console.log(`  ${r.ok ? 'ok  ' : 'FAIL'} ${sha.slice(0, 8)} ${msg.out.split(/\r?\n/)[0].slice(0, 62)}`);
    }
    console.log(`\nreviewed-trailer REPORT-ONLY: ${shas.length} commit(s) examined | ${wouldFail} WOULD FAIL | ${shas.length - wouldFail} would pass`);
    process.exit(0);
}

function main() {
    const argv = process.argv.slice(2);
    const rangeIdx = argv.indexOf('--range');
    if (rangeIdx !== -1) {
        if (!argv[rangeIdx + 1]) { console.error('reviewed-trailer: --range needs a rev-range.'); process.exit(1); }
        return reportRange(argv[rangeIdx + 1]);
    }
    const msgPath = argv.find((a) => !a.startsWith('--'));
    if (!msgPath) { console.error('reviewed-trailer: no commit-message file given. Usage: check-reviewed-trailer.mjs <COMMIT_EDITMSG> | --range <range>'); process.exit(1); }

    let message;
    try { message = readFileSync(msgPath, 'utf8'); } catch (e) {
        console.error(`reviewed-trailer: could not read the commit message at ${msgPath}: ${e.message}. Failing closed.`);
        process.exit(1);
    }
    if (message.trim() === '') { console.error('reviewed-trailer: the commit message is EMPTY. Failing closed.'); process.exit(1); }

    let gatedSubmodules;
    try { gatedSubmodules = loadGatedSubmodules(); } catch (e) {
        console.error(`reviewed-trailer: scripts/reviewed-trailer.config.json is unusable: ${e.message}. Failing closed.`);
        process.exit(1);
    }
    const state = (ref) => spawnSync('git', ['rev-parse', '-q', '--verify', ref], { cwd: ROOT, encoding: 'utf8' }).status === 0;
    const read = readStaged();
    if (read.error) { console.error(`reviewed-trailer: ${read.error}. Failing closed.`); process.exit(1); }

    const result = evaluate({ entries: read.entries, message, merge: state('MERGE_HEAD'), revert: state('REVERT_HEAD'), cherryPick: state('CHERRY_PICK_HEAD'), gatedSubmodules });
    const reportOnly = argv.includes('--report-only');
    if (result.exempt) { console.log(`reviewed-trailer: skipped 1 (${result.exempt})`); process.exit(0); }
    if (result.ok) { printCounts(result.counts, result.counts.allows > 0 ? 'PASS (escaped)' : 'PASS'); process.exit(0); }

    printCounts(result.counts, reportOnly ? 'WOULD FAIL (report-only)' : 'FAIL');
    printFailure(result);
    if (reportOnly) { console.error('\nreviewed-trailer: --report-only, reporting only, not blocking this commit.'); process.exit(0); }
    process.exit(1);
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) main();
