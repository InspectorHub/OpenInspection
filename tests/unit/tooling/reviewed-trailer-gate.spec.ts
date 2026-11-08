import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
// @ts-expect-error plain .mjs gate script, no types alongside it (same as the other tooling specs).
import { evaluate, isDocsOnly, parseRaw, parseConfig, loadGatedSubmodules } from '../../../scripts/check-reviewed-trailer.mjs';

const SCRIPT = resolve(__dirname, '../../../scripts/check-reviewed-trailer.mjs');

type Entry = string | { path: string; gitlink?: boolean; symlink?: boolean };
type Expect = Partial<Record<'ok' | 'exempt' | 'kind' | 'reviews' | 'malformed' | 'allows' | 'badAllows' | 'code', boolean | string | number>>;
type State = { merge?: boolean; revert?: boolean; cherryPick?: boolean; gatedSubmodules?: string[] };

/**
 * The reviewed-trailer gate reads commit messages and staged paths. Its whole
 * risk is waving things through, so the must-fail cases come first and every
 * pass has a failing neighbour. A judge that passes everything satisfies a
 * suite of passes.
 */
const CODE = ['apps/x/a.ts'];
const DOCS = ['docs/guide.md', 'README.md'];
const GOOD = 'Reviewed: independent read-only review of the staged diff, PASS WITH FIXES (applied)';
const gated = { path: 'vendor/lib', gitlink: true };
const LIST = { gatedSubmodules: ['vendor/lib'] };

/** [name, entries, message, expect, state?] where state is {merge?, revert?, cherryPick?} */
const CASES = [
    // Positive controls first: these MUST fail, or the judge is decorative.
    ['code without a Reviewed line fails', CODE, 'feat: add a thing', { ok: false, kind: 'missing' }],
    ['too-short Reviewed fails (chars)', CODE, 'feat: x\n\nReviewed: looked fine ok', { ok: false, malformed: 1 }],
    ['too-few-words Reviewed fails', CODE, 'feat: x\n\nReviewed: independent-read-only-review-PASS', { ok: false, malformed: 1 }],
    ['review-allow with a short reason fails', CODE, 'feat: x\n\nreview-allow: urgent', { ok: false, badAllows: 1 }],
    ['bare review-allow fails', CODE, 'feat: x\n\nreview-allow:', { ok: false, badAllows: 1 }],
    ['a Reviewed line commented out by git does not count', CODE, `feat: x\n\n# ${GOOD}`, { ok: false, reviews: 0 }],
    ['a malformed line fails even on a docs-only commit, and does not claim code changed', DOCS, 'docs: x\n\nReviewed: ok', { ok: false, malformed: 1, kind: 'malformed' }],
    ['zero staged files fails closed', [], 'chore: nothing', { ok: false, kind: 'empty' }],
    ['config files are code: package.json without a record fails', ['package.json'], 'chore: bump', { ok: false }],
    ['one code file among docs needs review', [...DOCS, 'scripts/a.mjs'], 'docs: x', { ok: false, code: 1 }],
    ['a docs-lookalike directory is code', ['docsite/a.ts'], 'feat: x', { ok: false }],
    ['a skill file under .claude/ is code', ['.claude/skills/x/SKILL.md'], 'docs: tweak a skill', { ok: false, code: 1 }],
    ['anything under .claude/ is code, any extension', ['.claude/settings.json', '.claude/notes.txt'], 'chore: x', { ok: false, code: 2 }],
    ['CLAUDE.md is code', ['CLAUDE.md'], 'docs: x', { ok: false }],
    ['a nested CLAUDE.md is code', ['apps/x/CLAUDE.md'], 'docs: x', { ok: false }],
    ['AGENTS.md is code', ['AGENTS.md'], 'docs: x', { ok: false }],
    ['a json file under docs/ is code', ['docs/docs-manifest.json'], 'docs: x', { ok: false }],
    ['a script under docs/ is code', ['docs/tool.py', 'docs/page.html', 'docs/t.tsv'], 'docs: x', { ok: false, code: 3 }],
    ['a symlink is code even when it looks like docs', [{ path: 'docs/link.md', symlink: true }], 'docs: x', { ok: false, code: 1 }],
    ['a gitlink outside the configured list is code', [{ path: 'vendor/other', gitlink: true }], 'chore: bump', { ok: false, code: 1 }, LIST],
    ['a gitlink is code when no list is configured', [{ path: 'vendor/lib', gitlink: true }], 'chore: bump', { ok: false, code: 1 }],
    ['a Merge subject without MERGE_HEAD is not exempt', CODE, 'Merge pull request #5 from a/b', { ok: false }],
    ['a Revert subject without REVERT_HEAD is not exempt', CODE, 'Revert "feat: x"\n\nThis reverts commit abc.', { ok: false }],
    ['a release-please subject is not exempt (it never runs a local hook)', ['package.json', 'CHANGELOG.md'], 'chore(main): release 1.4.0', { ok: false }],
    ['a cherry-pick is not exempt', CODE, 'feat: x', { ok: false }, { cherryPick: true }],
    ['FAIL verdict only does not count', CODE, 'feat: x\n\nReviewed: independent read-only review of the diff, FAIL', { ok: false, reviews: 0, malformed: 1 }],
    ['a lowercase verdict does not count (case-sensitive)', CODE, 'feat: x\n\nReviewed: independent read-only review of the diff, pass with fixes', { ok: false, malformed: 1 }],
    ['PASSED is not the token PASS', CODE, 'feat: x\n\nReviewed: independent read-only review of the diff PASSED', { ok: false, malformed: 1 }],
    ['a Reviewed line on the subject line is rejected', CODE, 'Reviewed: independent read-only review of the staged diff, PASS', { ok: false, malformed: 1 }],
    ['a Reviewed line on the subject line is rejected even with a valid one below', CODE, `Reviewed: independent review of the diff, PASS\n\n${GOOD}`, { ok: false, malformed: 1, reviews: 1 }],

    // Passes.
    ['docs-only commit passes with no record', DOCS, 'docs: reword the guide', { ok: true, code: 0 }],
    ['docs/x.md passes', ['docs/x.md'], 'docs: x', { ok: true }],
    ['prose and media under docs/ pass, case-insensitive', ['docs/a.mdx', 'docs/b.txt', 'docs/img/c.PNG', 'docs/d.svg', 'docs/e.webp', 'docs/F.MD'], 'docs: x', { ok: true, code: 0 }],
    ['a .md file outside docs/ is docs', ['README.md', 'apps/x/README.md'], 'docs: x', { ok: true }],
    ['valid Reviewed line passes', CODE, `feat: x\n\n${GOOD}`, { ok: true, reviews: 1 }],
    ['bare PASS verdict passes', CODE, 'feat: x\n\nReviewed: independent read-only review of the diff, PASS', { ok: true, reviews: 1 }],
    ['trailer in the middle of a multi-line message passes', CODE, `feat: x\n\nLong body line one.\n\n${GOOD}\n\nMore body after it.\nCo-Authored-By: someone <a@b.c>`, { ok: true, reviews: 1 }],
    ['two review passes are both counted', CODE, `feat: x\n\n${GOOD}\nReviewed: second pass on rules and gates, PASS after one fix`, { ok: true, reviews: 2 }],
    ['review-allow with a real reason passes and is counted', CODE, 'revert: x\n\nreview-allow: emergency rollback of a broken deploy', { ok: true, allows: 1 }],
    ['review-allow lets an empty commit through', [], 'chore: retrigger CI\n\nreview-allow: intentional empty commit, nothing staged', { ok: true, allows: 1 }],
    ['a gitlink on the configured list counts as docs', [gated], 'chore: bump pointer', { ok: true, code: 0 }, LIST],

    // Exempt commits.
    ['merge commit (MERGE_HEAD) is exempt', CODE, 'Merge branch x', { ok: true, exempt: 'merge commit (MERGE_HEAD)' }, { merge: true }],
    ['a git revert in progress (REVERT_HEAD) is exempt', CODE, 'Revert "feat: x"\n\nThis reverts commit abc.', { ok: true }, { revert: true }],
    ['REVERT_HEAD does not exempt a non-Revert subject', CODE, 'feat: sneaky', { ok: false }, { revert: true }],
    ['fixup! subject is exempt', CODE, 'fixup! feat: x', { ok: true }],
    ['squash! subject is exempt', CODE, 'squash! feat: x', { ok: true }],
    ['amend! subject is exempt', CODE, 'amend! feat: x', { ok: true }],
];

function runCli(args: string[], env: Record<string, string> = {}, config?: string) {
    const dir = mkdtempSync(join(tmpdir(), 'rt-gate-'));
    try {
        const git = (a: string[]) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
        git(['init', '-q']);
        mkdirSync(join(dir, 'scripts'));
        copyFileSync(SCRIPT, join(dir, 'scripts', 'check-reviewed-trailer.mjs'));
        if (config !== undefined) writeFileSync(join(dir, 'scripts', 'reviewed-trailer.config.json'), config);
        writeFileSync(join(dir, 'a.ts'), 'export {};\n');
        git(['add', 'a.ts']);
        writeFileSync(join(dir, 'MSG'), 'feat: x\n');
        return spawnSync(process.execPath, [join(dir, 'scripts', 'check-reviewed-trailer.mjs'), join(dir, 'MSG'), ...args], {
            cwd: dir, encoding: 'utf8', env: { ...process.env, ...env },
        });
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

describe('reviewed-trailer gate', () => {
    for (const [name, entries, message, expected, state] of CASES as [string, Entry[], string, Expect, State?][]) {
        it(name, () => {
            const r = evaluate({ entries, message, ...state });
            const got: Record<string, unknown> = { ok: r.ok, exempt: r.exempt, kind: r.kind, ...r.counts };
            for (const [k, v] of Object.entries(expected)) expect(got[k], k).toBe(v);
        });
    }

    it('has positive controls and passes in the same suite', () => {
        const fails = (CASES as unknown[][]).filter((c) => (c[3] as Expect).ok === false).length;
        const passes = (CASES as unknown[][]).filter((c) => (c[3] as Expect).ok === true).length;
        expect(fails).toBeGreaterThan(10);
        expect(passes).toBeGreaterThan(8);
    });

    it('isDocsOnly: prose and images under docs/, never json', () => {
        expect(isDocsOnly(['docs/a.md', 'docs/b.png'])).toBe(true);
        expect(isDocsOnly(['docs/a.json'])).toBe(false);
        expect(isDocsOnly(['docs/a.md', 'src/a.ts'])).toBe(false);
    });

    it('parseRaw reads gitlink and symlink modes from git diff --raw -z', () => {
        const raw = ':160000 160000 aaa bbb M\0vendor/lib\0:100644 100644 aaa bbb M\0src/a.ts\0:000000 120000 aaa bbb A\0docs/l.md\0';
        expect(parseRaw(raw)).toEqual([
            { path: 'vendor/lib', gitlink: true, symlink: false },
            { path: 'src/a.ts', gitlink: false, symlink: false },
            { path: 'docs/l.md', gitlink: false, symlink: true },
        ]);
    });

    it('a cherry-pick failure names review-allow', () => {
        const r = evaluate({ entries: ['apps/x/a.ts'], message: 'feat: x', cherryPick: true });
        expect(r.problems.join('\n')).toContain('review-allow');
    });

    it('the environment variable no longer downgrades a failure', () => {
        const r = runCli([], { REVIEWED_TRAILER_REPORT_ONLY: '1' });
        expect(r.status).toBe(1);
        expect(r.stdout).toContain('-> FAIL');
    });

    it('the explicit --report-only flag still reports without blocking', () => {
        const r = runCli(['--report-only']);
        expect(r.status).toBe(0);
        expect(r.stdout).toContain('WOULD FAIL');
    });

    it("this repository's real config file has the expected shape", () => {
        const list = loadGatedSubmodules();
        expect(Array.isArray(list)).toBe(true);
        for (const s of list) expect(typeof s).toBe('string');
        const raw = JSON.parse(readFileSync(resolve(__dirname, '../../../scripts/reviewed-trailer.config.json'), 'utf8'));
        expect(Object.keys(raw)).toEqual(['gatedSubmodules']);
    });

    it('a malformed config is an error, not an empty list', () => {
        expect(() => parseConfig('{ not json')).toThrow(/invalid JSON/);
        expect(() => parseConfig('{}')).toThrow(/gatedSubmodules/);
        expect(() => parseConfig('{"gatedSubmodules":"x"}')).toThrow(/gatedSubmodules/);
        expect(() => parseConfig('{"gatedSubmodules":[1]}')).toThrow(/gatedSubmodules/);
        expect(parseConfig('{"gatedSubmodules":[]}')).toEqual([]);
    });

    it('a missing config file means no exempt submodules (strict)', () => {
        expect(loadGatedSubmodules(join(tmpdir(), 'rt-gate-no-such-config.json'))).toEqual([]);
    });

    it('the hook fails closed on a malformed config file', () => {
        const r = runCli([], {}, '{ not json');
        expect(r.status).toBe(1);
        expect(r.stderr).toContain('unusable');
    });

    it('the hook runs normally with a valid config file', () => {
        const r = runCli([], {}, '{ "gatedSubmodules": [] }');
        expect(r.status).toBe(1);
        expect(r.stdout).toContain('-> FAIL');
    });
});
