#!/usr/bin/env node
/**
 * PR readiness check: a machine-checked WRITTEN RECORD that an independent code
 * review and (for UI changes) a browser check happened before merge.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS CANNOT DO
 * ---------------------------------------------------------------------------
 * It reads text. A body that says `Code review: Jane Doe, senior reviewer —
 * open findings: 0` passes whether or not Jane exists, and the "not self" rule
 * is an honour check (it rejects the words self, myself, author, me, own, same
 * in the reviewer text; it cannot know who the reviewer really was). The
 * Chrome tokens (`light: ok`, `dark: ok`) are a written assertion by the author:
 * the check makes a missing or evasive record impossible, not a false one. It makes
 * the record consistent and makes a MISSING record loud. The only thing it
 * verifies against reality is the UI-vs-n/a claim, which is compared with the
 * PR's real file list (renames count: the old path is a changed path too).
 *
 * Changes to this file and to .github/workflows/pr-readiness.yml need a human
 * diff review: a PR that edits its own checker must not be trusted to judge
 * itself. The workflow runs this file from the BASE branch for that reason.
 *
 * ---------------------------------------------------------------------------
 * THE RECORD (in the PR body)
 * ---------------------------------------------------------------------------
 *   ## Verification
 *   Code review: <who or what reviewed, 3+ words> — open findings: 0
 *   Chrome: /<route> — light: ok, dark: ok — <what was seen>     (the portal has no dark mode: light: ok only)
 *   (or, when no UI file changed)  Chrome: n/a — no UI files changed
 *
 * The PR must also not be a draft (draft = not verified yet).
 *
 * ---------------------------------------------------------------------------
 * USAGE
 * ---------------------------------------------------------------------------
 *   node scripts/pr-readiness.mjs --pr <n> [--repo owner/name]
 *       reads the PR through the `gh` CLI. Without --repo, the repository is
 *       taken from a git checkout with a remote (or GITHUB_REPOSITORY).
 *   node scripts/pr-readiness.mjs
 *       Actions mode: the PR number comes from GITHUB_EVENT_PATH, the live PR
 *       is fetched with `gh api` (the event payload can be stale on a re-run).
 *   Offline (no network, used by the tests and for dry runs):
 *       --body-file <path> --files-from <path> [--draft]
 *
 * Exit 1 when any rule fails. Both numbers are printed (rules checked, rules
 * failed) so an empty parse cannot read as green.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// ── repo-specific constants ─────────────────────────────────────────────────
export const REPO_KIND = 'engine';
const KIND_UI = (f) => /^messages\//.test(f) || /^packages\/shared-ui\//.test(f);
const THEMES = ['light', 'dark'];
const CHROME_FORM = 'Chrome: /route — light: ok, dark: ok — <what was seen>';
const CHROME_EXAMPLE = 'Chrome: /inspections — light: ok, dark: ok — list renders and filters work';
const EXAMPLE_REPO = 'InspectorHub/OpenInspection';

// ── UI file detection ───────────────────────────────────────────────────────
// Paths that never render: tests, mocks, stories, generated output and data fixtures.
// tailwind/vite config are deliberately NOT here: they restyle or rebuild every
// screen, so a change there is a UI change (the safe direction).
const TEST_PATH =
    /(^|\/)(tests?|__tests__|__mocks__)\/|\.(spec|test|stories)\.[^/]*$|\.spec-d\.[^/]*$|^server\/(generated|data)\//;
const NOT_UI_JSON = /(^|\/)(package(-lock)?|tsconfig[^/]*|knip)\.json$/;
const ASSET = /\.(tsx|css|html|svg|png|jpe?g|webp|gif|ico|woff2?|json)$/i;
const ROOT_UI = /^(index\.html|(tailwind|vite)\.config\.[cm]?[jt]s)$/;

export function isUiFile(file) {
    const f = String(file).replace(/\\/g, '/').replace(/^\.\//, '');
    if (TEST_PATH.test(f) || NOT_UI_JSON.test(f)) return false;
    if (ROOT_UI.test(f) || /^public\//.test(f) || KIND_UI(f)) return true;
    if (/^app\/.+\.(ts|tsx|css|html|svg|png|jpe?g|webp|gif|ico|woff2?|json)$/i.test(f)) return true;
    return /^(server|packages)\/.+/.test(f) && ASSET.test(f);
}

/** Every path a PR touches: new path AND the old path of a rename. Accepts strings or {filename, previous_filename}. */
export function expandPaths(files) {
    const out = new Set();
    for (const item of Array.isArray(files) ? files : []) {
        if (item && typeof item === 'object') {
            if (item.filename) out.add(item.filename);
            if (item.previous_filename) out.add(item.previous_filename);
        } else if (typeof item === 'string') {
            for (const p of item.split(/\s*(?:->|=>)\s*/)) if (p.trim()) out.add(p.trim());
        }
    }
    return [...out];
}

// ── parsing helpers ─────────────────────────────────────────────────────────
const SEP = '(?:--|[-\\u2014\\u2013\\u2212])';
const SELF_TOKENS = new Set(['self', 'myself', 'author', 'me', 'own', 'same']);
const TEMPLATE_TOKEN = /<(?:reviewer|n|route|who\b[^<>\n]*|what\b[^<>\n]*)>/gi;

/** Section body under `## Verification`; comments, unclosed comments and fenced code are dropped first. */
export function extractVerification(body) {
    let text = String(body ?? '').replace(/\r/g, '');
    for (let prev = ''; prev !== text; ) {
        prev = text;
        text = text.replace(/<!--[\s\S]*?-->/g, '');
    }
    // Only an unclosed opener that is NOT inside a code span swallows the rest.
    for (let at = text.indexOf('<!--'); at !== -1; at = text.indexOf('<!--', at + 1)) {
        const lineStart = text.lastIndexOf('\n', at) + 1;
        const ticks = (text.slice(lineStart, at).match(/`/g) ?? []).length;
        if (ticks % 2 === 0) {
            text = text.slice(0, at);
            break;
        }
    }
    const kept = [];
    let fence = null;
    for (const line of text.split('\n')) {
        const m = /^\s*(`{3,}|~{3,})/.exec(line);
        if (fence) {
            if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
            continue;
        }
        if (m) {
            fence = m[1];
            continue;
        }
        kept.push(line);
    }
    const start = kept.findIndex((l) => /^##\s+Verification\s*$/i.test(l.trim()));
    if (start === -1) return null;
    const out = [];
    for (let i = start + 1; i < kept.length; i++) {
        if (/^##\s+\S/.test(kept[i])) break;
        out.push(kept[i]);
    }
    return out.join('\n');
}

/** Strip list/quote/numbering prefixes and markdown emphasis so `- **Code review:** x` reads as `Code review: x`. */
function normalise(line) {
    return line
        .replace(/\r/g, '')
        .replace(/^\s*(?:>\s*)*/, '')
        .replace(/^(?:[-*+]|\d+[.)])\s+/, '')
        .replace(/^\[[ xX]\]\s*/, '')
        .replace(/\*\*|__|`/g, '')
        .trim();
}

function linesFor(section, label) {
    const re = new RegExp(`^${label}\\s*:\\s*(.*)$`, 'i');
    const out = [];
    for (const raw of section.split('\n')) {
        const m = re.exec(normalise(raw));
        if (m) out.push(m[1].trim());
    }
    return out;
}

const result = (id, name, ok, detail, example) => ({ id, name, ok, detail, example });

function reviewLine(text) {
    const m = new RegExp(`^(.*?)\\s*(?:${SEP}|:|,|;|\\()\\s*open findings\\s*[:=]?\\s*(.*)$`, 'i').exec(text);
    if (!m) return { ok: false, detail: 'line must read: Code review: <who reviewed> — open findings: 0' };
    const who = m[1].trim();
    const rest = m[2].trim();
    if (/open findings/i.test(who) || /open findings/i.test(rest))
        return { ok: false, detail: 'more than one "open findings" on the line; write it once, with the number 0' };
    const words = who.split(/\s+/).filter(Boolean);
    const tokens = who.toLowerCase().split(/[^a-z]+/).filter(Boolean);
    if (words.length < 3) return { ok: false, detail: `reviewer must be at least 3 words (got "${who}")` };
    if (new Set(words.map((w) => w.toLowerCase())).size < 2) return { ok: false, detail: `reviewer text repeats one word ("${who}")` };
    const selfWord = tokens.find((t) => SELF_TOKENS.has(t));
    if (selfWord)
        return {
            ok: false,
            detail: `reviewer "${who}" contains the word "${selfWord}", which reads as a self-check. This is an honour check on the words, not on the person: if the review was independent, say so with a clarifying word such as the tool or team name (e.g. "independent reviewer agent pass 2")`,
        };
    if (!/^0\)?(?:\s*\((?:none|zero|all fixed|nothing left)\))?\.?$/i.test(rest))
        return { ok: false, detail: `open findings must be exactly 0, optionally followed by (none), (zero), (all fixed) or (nothing left) (got "${rest}")` };
    return { ok: true, detail: `${who} — open findings: 0` };
}

function chromeLine(r, uiFiles, noFiles = false) {
    const uiNote = uiFiles.length ? ` (UI files changed: ${uiFiles.slice(0, 3).join(', ')}${uiFiles.length > 3 ? ', ...' : ''})` : '';
    if (/^n\/a\b/i.test(r)) {
        if (noFiles) return { ok: false, detail: 'Chrome claims n/a but the PR reports ZERO changed files; the claim cannot be verified (empty file list or API answer?)' };
        if (uiFiles.length) return { ok: false, detail: `Chrome claims n/a but UI files changed${uiNote}` };
        if (!/no ui files changed/i.test(r)) return { ok: false, detail: 'n/a form must read: Chrome: n/a — no UI files changed' };
        return { ok: true, detail: 'n/a, verified against the file list (no UI files changed)' };
    }
    const m = new RegExp(`^(\\/\\S*?)\\s*(?:${SEP}|:)\\s+(.*)$`).exec(r);
    if (!m) return { ok: false, detail: `line must read: ${CHROME_FORM}` };
    // The observation is what follows the LAST dash; the theme tokens sit before it.
    let cut = -1;
    let cutEnd = -1;
    for (const d of m[2].matchAll(new RegExp(`\\s${SEP}\\s`, 'g'))) {
        cut = d.index;
        cutEnd = d.index + d[0].length;
    }
    if (cut === -1) return { ok: false, detail: `the theme tokens and the observation are separated by a dash; line must read: ${CHROME_FORM}` };
    const tokens = m[2].slice(0, cut);
    const seen = m[2].slice(cutEnd).trim();
    if (seen.length < 15) return { ok: false, detail: `observation after the last dash must be at least 15 characters (got ${seen.length}); line must read: ${CHROME_FORM}` };
    if (/^(looks fine|lgtm)\.?$/i.test(seen)) return { ok: false, detail: 'observation must say what was seen, not "looks fine"' };
    for (const t of THEMES) {
        const values = [...tokens.matchAll(new RegExp(`\\b${t}\\s*:\\s*([^\\s,;]+)`, 'gi'))].map((x) => x[1].replace(/[.)]+$/, '').toLowerCase());
        if (!values.length) return { ok: false, detail: `missing the literal token "${t}: ok"; line must read: ${CHROME_FORM}` };
        for (const v of values) {
            if (v === 'ok') continue;
            if (t === 'dark' && v === 'n/a') {
                const reason = /\bdark\s*:\s*n\/a\s*\(([^)]*)\)/i.exec(tokens);
                if (reason && reason[1].trim().split(/\s+/).length >= 4) continue;
                return { ok: false, detail: '"dark: n/a" needs a reason of at least 4 words in parentheses, e.g. "dark: n/a (this view has no dark theme styling at all)"' };
            }
            return { ok: false, detail: `"${t}: ${v}" is not accepted: the value must be "ok"${t === 'dark' ? ' (or "n/a" with a reason)' : ''}; line must read: ${CHROME_FORM}` };
        }
    }
    return { ok: true, detail: `${m[1]} — ${tokens.trim()} — ${seen}` };
}

// ── rules ───────────────────────────────────────────────────────────────────
/**
 * Pure. `files`: changed paths (strings, or GitHub file objects with
 * previous_filename). `repoKind` is accepted for call compatibility and
 * ignored: each repository ships a copy fixed to its own kind.
 * `skipDraft` is for an already-merged PR (the draft rule is moot).
 */
export function checkPrReadiness({ body, isDraft, files, skipDraft = false }) {
    const allPaths = expandPaths(files);
    const uiFiles = allPaths.filter(isUiFile);
    const section = extractVerification(body);
    const rules = [];

    rules.push(
        skipDraft
            ? result('not-draft', 'PR is not a draft', true, 'skipped (merged PR)')
            : result('not-draft', 'PR is not a draft', !isDraft,
                  isDraft ? 'Draft PR: mark ready only after review and Chrome verification are recorded' : 'ready for review',
                  'gh pr ready <number>   (only once the lines below are true)'),
    );

    rules.push(
        result('verification-section', 'Body has a "## Verification" section', section !== null && section.trim() !== '',
            section === null ? 'no "## Verification" heading found (expected exactly a line "## Verification")' : section.trim() === '' ? 'section is empty' : 'found',
            '## Verification'),
    );

    {
        const lines = section ? linesFor(section, 'Code review') : [];
        let ok = false;
        let detail = 'no "Code review: <who> — open findings: 0" line in Verification';
        if (lines.length) {
            const checked = lines.map(reviewLine);
            const bad = checked.find((c) => !c.ok);
            ok = !bad;
            detail = bad ? bad.detail : checked[0].detail;
        }
        rules.push(result('code-review', 'Independent code review recorded, 0 open findings', ok, detail,
            'Code review: independent reviewer agent pass 2 — open findings: 0'));
    }

    {
        const lines = section ? linesFor(section, 'Chrome') : [];
        let ok = false;
        let detail;
        const uiNote = uiFiles.length ? ` (UI files changed: ${uiFiles.slice(0, 3).join(', ')}${uiFiles.length > 3 ? ', ...' : ''})` : '';
        if (!lines.length) {
            detail = uiFiles.length ? `UI files changed but no "${CHROME_FORM}" line${uiNote}` : 'no "Chrome:" line (use "Chrome: n/a — no UI files changed" when true)';
        } else {
            const checked = lines.map((l) => chromeLine(l, uiFiles, allPaths.length === 0));
            const bad = checked.find((c) => !c.ok);
            ok = !bad;
            detail = bad ? bad.detail : checked[0].detail;
        }
        rules.push(result('chrome', 'Browser verification recorded (or UI-free claim is true)', ok, detail,
            uiFiles.length ? CHROME_EXAMPLE : 'Chrome: n/a — no UI files changed'));
    }

    {
        let ok = false;
        let detail = 'no Verification section to check';
        if (section !== null) {
            const found = [];
            if (/\bTBD\b/i.test(section)) found.push('TBD');
            if (/\bTODO\b/i.test(section)) found.push('TODO');
            for (const m of section.matchAll(TEMPLATE_TOKEN)) found.push(m[0]);
            if (/^(looks fine|lgtm)\.?$/i.test(section.replace(/\s+/g, ' ').trim())) found.push(section.trim());
            ok = found.length === 0;
            detail = ok ? 'none' : `unfilled: ${[...new Set(found)].join(' ')}`;
        }
        rules.push(result('placeholders', 'No unfilled placeholders in Verification', ok, detail,
            'replace <reviewer>, <n>, <route>, <what was seen...>, TBD and TODO with real text'));
    }

    const failed = rules.filter((r) => !r.ok).length;
    return { ok: failed === 0, checked: rules.length, failed, rules, uiFiles };
}

export function formatReport(res, title = 'pr-readiness') {
    const lines = [`${title}`];
    for (const r of res.rules) {
        lines.push(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}: ${r.detail}`);
        if (!r.ok && r.example) lines.push(`        e.g. ${r.example}`);
    }
    lines.push(`${res.checked} rules checked, ${res.failed} failed`);
    return lines.join('\n');
}

// ── GitHub access (gh CLI) ──────────────────────────────────────────────────
export const defaultGh = (args) =>
    execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }).trim();

// Without a repo, `{owner}/{repo}` is resolved by gh from the git remote of the
// current checkout; outside one it fails, so pass --repo (or GITHUB_REPOSITORY).
const repoSlug = (repo) => repo ?? '{owner}/{repo}';

/** Changed paths of a PR, new path and (for renames) the old path. */
export const FILES_JQ = '.[] | {filename, previous_filename} | tojson';

/** One JSON object per line (from FILES_JQ) to the list of every changed path, old names of renames included. */
export function parseFilesNdjson(text) {
    const objs = String(text ?? '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
    return expandPaths(objs);
}

export function fetchPrFiles(repo, number, gh = defaultGh) {
    return parseFilesNdjson(gh(['api', `repos/${repoSlug(repo)}/pulls/${number}/files`, '--paginate', '--jq', FILES_JQ]));
}

export function fetchPr(repo, number, gh = defaultGh) {
    const pr = JSON.parse(gh(['api', `repos/${repoSlug(repo)}/pulls/${number}`]));
    return { number, body: pr.body ?? '', isDraft: !!pr.draft, merged: !!pr.merged_at, mergedAt: pr.merged_at ?? null };
}

// ── CLI ─────────────────────────────────────────────────────────────────────
const USAGE = `usage:
  node scripts/pr-readiness.mjs --pr <number> [--repo owner/name]
  node scripts/pr-readiness.mjs                       (Actions mode: PR number from GITHUB_EVENT_PATH)
  node scripts/pr-readiness.mjs --body-file <path> --files-from <path> [--draft]   (offline)
Without --repo the repository comes from a git checkout with a remote (or GITHUB_REPOSITORY);
outside a checkout pass --repo, e.g. --repo ${EXAMPLE_REPO}.`;

function arg(argv, name) {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
}

const readList = (p) => readFileSync(p, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

export function main(argv = process.argv.slice(2), env = process.env) {
    if (argv.includes('--help') || argv.includes('-h')) {
        console.log(USAGE);
        return 0;
    }
    const repo = arg(argv, '--repo') ?? env.GITHUB_REPOSITORY;
    let res;
    let title;
    if (arg(argv, '--body-file')) {
        res = checkPrReadiness({
            body: readFileSync(arg(argv, '--body-file'), 'utf8'),
            isDraft: argv.includes('--draft'),
            files: arg(argv, '--files-from') ? readList(arg(argv, '--files-from')) : [],
        });
        title = `pr-readiness (offline, ${REPO_KIND})`;
    } else {
        let n = arg(argv, '--pr') ? Number(arg(argv, '--pr')) : NaN;
        if (Number.isNaN(n) && env.GITHUB_EVENT_PATH) {
            n = Number(JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8')).pull_request?.number);
        }
        if (!Number.isInteger(n) || n <= 0) {
            console.error(USAGE);
            return 2;
        }
        const pr = fetchPr(repo, n);
        const files = arg(argv, '--files-from') ? readList(arg(argv, '--files-from')) : fetchPrFiles(repo, n);
        res = checkPrReadiness({ body: pr.body, isDraft: pr.isDraft, files, skipDraft: pr.merged });
        title = `pr-readiness for PR #${n} (${REPO_KIND})`;
    }
    console.log(formatReport(res, title));
    return res.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        process.exit(main());
    } catch (e) {
        console.error(`pr-readiness: ${e instanceof Error ? e.message : e}`);
        process.exit(1);
    }
}
