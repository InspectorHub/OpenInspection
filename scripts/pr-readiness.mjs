#!/usr/bin/env node
/**
 * PR readiness check: a machine-checked WRITTEN RECORD that an independent code
 * review and (for UI changes) a browser check happened before merge.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS CANNOT DO
 * ---------------------------------------------------------------------------
 * It reads text. A body that says `Code review: Jane Doe, senior reviewer —
 * open findings: 0` passes whether or not Jane exists. It makes the record
 * consistent and makes a MISSING record loud; it does not prove the work. The
 * only thing it verifies against reality is the UI-vs-n/a claim, which is
 * compared with the PR's real file list.
 *
 * ---------------------------------------------------------------------------
 * THE RECORD (in the PR body)
 * ---------------------------------------------------------------------------
 *   ## Verification
 *   Code review: <who or what reviewed, 3+ words> — open findings: 0
 *   Chrome: /<route> — <what was seen, light and dark>
 *   (or, when no UI file changed)  Chrome: n/a — no UI files changed
 *
 * The PR must also not be a draft (draft = not verified yet).
 *
 * ---------------------------------------------------------------------------
 * USAGE
 * ---------------------------------------------------------------------------
 *   node scripts/pr-readiness.mjs --pr <n> [--repo owner/name]   local, via `gh`
 *   node scripts/pr-readiness.mjs --commit <sha> [--repo o/n]     the PR that produced a commit
 *   node scripts/pr-readiness.mjs                                 Actions mode (GITHUB_EVENT_PATH)
 *   add --files-from <path> to read the changed-file list (one per line) from
 *   a file instead of GitHub (used to simulate the workflow offline).
 *
 * Exit 1 when any rule fails. Both numbers are printed (rules checked, rules
 * failed) so an empty parse cannot read as green.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// ── repo kinds ──────────────────────────────────────────────────────────────
const NOT_TEST = (f) => !/\.(spec|test)\.[cm]?[jt]sx?$/.test(f);
const UI_MATCHERS = {
    engine: (f) =>
        (/^app\/.+\.(tsx|ts|css)$/.test(f) && NOT_TEST(f)) || /^messages\//.test(f) || /^public\//.test(f),
    portal: (f) =>
        (/^app\/.+\.(tsx|css)$/.test(f) && NOT_TEST(f)) || /^app\/content\//.test(f),
};

export function isUiFile(file, repoKind) {
    return (UI_MATCHERS[repoKind] ?? UI_MATCHERS.portal)(file);
}

// ── parsing helpers ─────────────────────────────────────────────────────────
const DASH = '[-\\u2014\\u2013]';
const SELF_WORDS = new Set([
    'self', 'review', 'self-review', 'self-check', 'check', 'author', 'myself', 'me', 'my', 'own', 'by', 'the', 'of', 'a',
]);

/** The `## Verification` section: heading to the next `## ` heading or the end. HTML comments are dropped. */
export function extractVerification(body) {
    const text = String(body ?? '').replace(/<!--[\s\S]*?-->/g, '');
    const lines = text.split(/\r?\n/);
    const start = lines.findIndex((l) => /^##\s+Verification\s*$/i.test(l.trim()));
    if (start === -1) return null;
    const out = [];
    for (let i = start + 1; i < lines.length; i++) {
        if (/^##\s+\S/.test(lines[i])) break;
        out.push(lines[i]);
    }
    return out.join('\n');
}

function findLine(section, label) {
    const re = new RegExp(`^\\s*(?:[-*]\\s*)?(?:\\[[ xX]\\]\\s*)?${label}\\s*:\\s*(.*)$`, 'i');
    for (const line of section.split('\n')) {
        const m = re.exec(line);
        if (m) return m[1].trim();
    }
    return null;
}

// ── rules ───────────────────────────────────────────────────────────────────
const result = (id, name, ok, detail) => ({ id, name, ok, detail });

/**
 * Pure. `files` is the list of changed file paths. `repoKind` is 'engine' or 'portal'.
 * `skipDraft` is for an already-merged PR (the draft rule is moot).
 */
export function checkPrReadiness({ body, isDraft, files, repoKind, skipDraft = false }) {
    const kind = repoKind === 'engine' ? 'engine' : 'portal';
    const changed = Array.isArray(files) ? files : [];
    const uiFiles = changed.filter((f) => isUiFile(f, kind));
    const section = extractVerification(body);
    const rules = [];

    // e) draft
    rules.push(
        skipDraft
            ? result('not-draft', 'PR is not a draft', true, 'skipped (merged PR)')
            : result(
                  'not-draft',
                  'PR is not a draft',
                  !isDraft,
                  isDraft ? 'Draft PR: mark ready only after review and Chrome verification are recorded' : 'ready for review',
              ),
    );

    // a) section
    rules.push(
        result('verification-section', 'Body has a "## Verification" section', section !== null && section.trim() !== '',
            section === null ? 'no "## Verification" heading found' : section.trim() === '' ? 'section is empty' : 'found'),
    );

    // b) code review
    {
        let ok = false;
        let detail = 'no "Code review: <who> — open findings: 0" line in Verification';
        const line = section ? findLine(section, 'Code review') : null;
        if (line !== null) {
            const m = new RegExp(`^(.*?)\\s*(?:${DASH}|:|,|;|\\()\\s*open findings\\s*[:=]?\\s*(\\S+?)\\)?\\s*$`, 'i').exec(
                line,
            );
            if (!m) {
                detail = 'line must read: Code review: <who reviewed> — open findings: 0';
            } else {
                const who = m[1].trim();
                const n = m[2].trim();
                const words = who.split(/\s+/).filter(Boolean);
                const selfOnly = words.length > 0 && words.every((w) => SELF_WORDS.has(w.toLowerCase().replace(/[^a-z-]/g, '')));
                if (words.length < 3) detail = `reviewer must be at least 3 words (got "${who}")`;
                else if (selfOnly) detail = `reviewer "${who}" is a self-check, not an independent review`;
                else if (n !== '0') detail = `open findings must be exactly 0 (got "${n}")`;
                else {
                    ok = true;
                    detail = `${who} — open findings: 0`;
                }
            }
        }
        rules.push(result('code-review', 'Independent code review recorded, 0 open findings', ok, detail));
    }

    // c) chrome
    {
        let ok = false;
        let detail;
        const line = section ? findLine(section, 'Chrome') : null;
        const uiNote = uiFiles.length ? ` (UI files changed: ${uiFiles.slice(0, 3).join(', ')}${uiFiles.length > 3 ? ', ...' : ''})` : '';
        if (!line) {
            detail = (uiFiles.length ? 'UI files changed but no "Chrome: /<route> — <what was seen>" line' : 'no "Chrome:" line (use "Chrome: n/a — no UI files changed" when true)') + uiNote;
        } else {
            const r = line;
            const na = /^n\/a\b/i.test(r);
            const m = new RegExp(`^(/\\S*)\\s+${DASH}\\s+(.*)$`).exec(r);
            if (na) {
                if (uiFiles.length) detail = `Chrome claims n/a but UI files changed${uiNote}`;
                else if (!/no ui files changed/i.test(r)) detail = 'n/a form must read: Chrome: n/a — no UI files changed';
                else {
                    ok = true;
                    detail = 'n/a, verified against the file list (no UI files changed)';
                }
            } else if (!m) {
                detail = 'line must read: Chrome: /<route> — <what was seen>';
            } else {
                const seen = m[2].trim();
                const needLight = /\blight\b/i.test(seen);
                const darkNa = /dark:\s*n\/a(.*)$/i.exec(seen);
                const needDark = darkNa ? darkNa[1].replace(/[\s,;.:()-]/g, '').length >= 3 : /\bdark\b/i.test(seen);
                if (seen.length < 15) detail = `observation after the dash must be at least 15 characters (got ${seen.length})`;
                else if (/^(looks fine|lgtm)\.?$/i.test(seen)) detail = 'observation must say what was seen, not "looks fine"';
                else if (!needLight) detail = 'must state that light mode was checked';
                else if (kind === 'engine' && !needDark) detail = 'must state dark mode was checked, or "dark: n/a" plus a reason';
                else {
                    ok = true;
                    detail = `${m[1]} — ${seen}`;
                }
            }
        }
        rules.push(result('chrome', 'Browser verification recorded (or UI-free claim is true)', ok, detail));
    }

    // d) placeholders
    {
        let ok = false;
        let detail = 'no Verification section to check';
        if (section !== null) {
            const found = [];
            if (/\bTBD\b/i.test(section)) found.push('TBD');
            if (/\bTODO\b/i.test(section)) found.push('TODO');
            for (const m of section.matchAll(/<[^<>\n]+>/g)) found.push(m[0]);
            const content = section.replace(/\s+/g, ' ').trim();
            if (/^(looks fine|lgtm)\.?$/i.test(content)) found.push(content);
            ok = found.length === 0;
            detail = ok ? 'none' : `unfilled: ${[...new Set(found)].join(' ')}`;
        }
        rules.push(result('placeholders', 'No unfilled placeholders in Verification', ok, detail));
    }

    const failed = rules.filter((r) => !r.ok).length;
    return { ok: failed === 0, checked: rules.length, failed, rules, uiFiles };
}

export function formatReport(res, title = 'pr-readiness') {
    const lines = [`${title}`];
    for (const r of res.rules) lines.push(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}: ${r.detail}`);
    lines.push(`${res.checked} rules checked, ${res.failed} failed`);
    return lines.join('\n');
}

// ── GitHub access (gh CLI) ──────────────────────────────────────────────────
const defaultGh = (args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }).trim();

export function detectRepoKind() {
    try {
        const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
        return /portal/i.test(pkg.name ?? '') ? 'portal' : 'engine';
    } catch {
        return 'portal';
    }
}

const repoSlug = (repo) => repo ?? '{owner}/{repo}';

export function fetchPrFiles(repo, number, gh = defaultGh) {
    const out = gh(['api', `repos/${repoSlug(repo)}/pulls/${number}/files`, '--paginate', '--jq', '.[].filename']);
    return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

export function fetchPr(repo, number, gh = defaultGh) {
    const pr = JSON.parse(gh(['api', `repos/${repoSlug(repo)}/pulls/${number}`]));
    return { number, body: pr.body ?? '', isDraft: !!pr.draft, merged: !!pr.merged_at };
}

/**
 * The PR that produced a commit (the deploy gate uses this). Prefers a merged
 * PR; falls back to an open PR whose head is exactly this commit. Returns the
 * readiness result with the draft rule skipped (the record is what matters
 * here, not the PR's current state), or { noPr: true }.
 */
export function checkCommitPr({ sha, repo, repoKind, gh = defaultGh }) {
    const prs = JSON.parse(gh(['api', `repos/${repoSlug(repo)}/commits/${sha}/pulls`]));
    const merged = prs.find((p) => p.merged_at);
    const open = prs.find((p) => p.state === 'open' && p.head?.sha === sha);
    const pick = merged ?? open;
    if (!pick) return { noPr: true, prs: prs.map((p) => p.number) };
    const pr = fetchPr(repo, pick.number, gh);
    const files = fetchPrFiles(repo, pick.number, gh);
    const res = checkPrReadiness({ body: pr.body, isDraft: false, files, repoKind, skipDraft: true });
    return { ...res, number: pick.number, merged: !!merged };
}

// ── CLI ─────────────────────────────────────────────────────────────────────
function arg(argv, name) {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
}

export function main(argv = process.argv.slice(2), env = process.env) {
    const repoKind = arg(argv, '--kind') ?? detectRepoKind();
    const repo = arg(argv, '--repo') ?? env.GITHUB_REPOSITORY;
    const filesFrom = arg(argv, '--files-from');
    const readFiles = (n) =>
        filesFrom ? readFileSync(filesFrom, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : fetchPrFiles(repo, n);

    let res;
    let title;
    if (arg(argv, '--commit')) {
        const r = checkCommitPr({ sha: arg(argv, '--commit'), repo, repoKind });
        if (r.noPr) {
            console.error('pr-readiness: no merged (or open, same-head) PR found for that commit; direct pushes have no record');
            return 1;
        }
        res = r;
        title = `pr-readiness for the PR behind the commit: #${r.number} (${r.merged ? 'merged' : 'open'}, draft rule skipped)`;
    } else if (arg(argv, '--pr')) {
        const n = Number(arg(argv, '--pr'));
        const pr = fetchPr(repo, n);
        res = checkPrReadiness({ body: pr.body, isDraft: pr.isDraft, files: readFiles(n), repoKind, skipDraft: pr.merged });
        title = `pr-readiness for PR #${n} (${repoKind})`;
    } else if (env.GITHUB_EVENT_PATH) {
        const ev = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
        const pr = ev.pull_request;
        if (!pr) {
            console.error('pr-readiness: event payload has no pull_request');
            return 1;
        }
        res = checkPrReadiness({ body: pr.body ?? '', isDraft: !!pr.draft, files: readFiles(pr.number), repoKind });
        title = `pr-readiness for PR #${pr.number} (${repoKind})`;
    } else {
        console.error('usage: node scripts/pr-readiness.mjs --pr <number> [--repo owner/name]');
        return 2;
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
