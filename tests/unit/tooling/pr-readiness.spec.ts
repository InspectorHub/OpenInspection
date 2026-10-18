import { describe, it, expect } from 'vitest';
// @ts-expect-error -- plain .mjs helper, no types alongside it (same as the other tooling specs).
import * as mod from '../../../scripts/pr-readiness.mjs';

type Rule = { id: string; ok: boolean; detail: string };
type Res = { ok: boolean; checked: number; failed: number; rules: Rule[]; noPr?: boolean };
const checkPrReadiness = mod.checkPrReadiness as (a: Record<string, unknown>) => Res;
const checkCommitPr = mod.checkCommitPr as (a: Record<string, unknown>) => Res;
const extractVerification = mod.extractVerification as (b: string) => string | null;

const GOOD_REVIEW = 'Code review: independent reviewer agent pass 2 — open findings: 0';
const GOOD_CHROME = 'Chrome: /company/acme/team — invite dialog renders, light and dark checked';
const UI = ['app/routes/team.tsx'];
const NO_UI = ['server/lib/foo.ts', 'docs/x.md'];

const body = (...lines: string[]) => ['## Summary', 'x', '', '## Verification', ...lines, '', '## Notes', 'y'].join('\n');
const run = (b: string, files: string[] = NO_UI, extra: Record<string, unknown> = {}) =>
    checkPrReadiness({ body: b, isDraft: false, files, repoKind: 'engine', ...extra });
const failedIds = (r: Res) => r.rules.filter((x) => !x.ok).map((x) => x.id);

describe('pr-readiness: happy paths', () => {
    it('passes a complete UI-free record', () => {
        const r = run(body(GOOD_REVIEW, 'Chrome: n/a — no UI files changed'));
        expect(failedIds(r)).toEqual([]);
        expect(r.ok).toBe(true);
        expect(r.checked).toBe(5);
        expect(r.failed).toBe(0);
    });
    it('passes a complete UI record', () => {
        expect(run(body(GOOD_REVIEW, GOOD_CHROME), UI).ok).toBe(true);
    });
    it('accepts -, em dash and colon separators in the review line', () => {
        expect(run(body('Code review: independent agent review pass - open findings: 0', 'Chrome: n/a - no UI files changed')).ok).toBe(true);
        expect(run(body('- Code review: independent agent review pass: open findings: 0', 'Chrome: n/a — no UI files changed')).ok).toBe(true);
    });
    it('ignores HTML comments in the template', () => {
        expect(run(body('<!-- <reviewer> goes here -->', GOOD_REVIEW, 'Chrome: n/a — no UI files changed')).ok).toBe(true);
    });
});

describe('rule a: Verification section', () => {
    it('fails without the heading', () => {
        const r = run('## Summary\nnothing');
        expect(failedIds(r)).toContain('verification-section');
    });
    it('fails for an empty section', () => {
        expect(failedIds(run('## Verification\n\n## Next\nx'))).toContain('verification-section');
    });
    it('extracts only up to the next level-2 heading', () => {
        expect(extractVerification(body('a'))).toBe('a\n');
    });
});

describe('rule b: code review line', () => {
    it('fails with open findings above zero', () => {
        const r = run(body('Code review: independent reviewer agent — open findings: 2', 'Chrome: n/a — no UI files changed'));
        expect(failedIds(r)).toEqual(['code-review']);
    });
    it('fails with open findings n/a', () => {
        expect(failedIds(run(body('Code review: independent reviewer agent — open findings: n/a', 'Chrome: n/a — no UI files changed')))).toEqual(['code-review']);
    });
    it('fails with a reviewer under three words', () => {
        expect(failedIds(run(body('Code review: Bob — open findings: 0', 'Chrome: n/a — no UI files changed')))).toEqual(['code-review']);
    });
    it.each(['self', 'self-review', 'author', 'self review by author', 'the author'])('rejects the self-check reviewer "%s"', (who) => {
        const r = run(body(`Code review: ${who} — open findings: 0`, 'Chrome: n/a — no UI files changed'));
        expect(failedIds(r)).toEqual(['code-review']);
    });
    it('fails when the line is missing', () => {
        expect(failedIds(run(body('Chrome: n/a — no UI files changed')))).toEqual(['code-review']);
    });
});

describe('rule c: Chrome', () => {
    it('fails when UI files changed and there is no Chrome line', () => {
        expect(failedIds(run(body(GOOD_REVIEW), UI))).toEqual(['chrome']);
    });
    it('fails an n/a claim when UI files changed (checked against the file list)', () => {
        const r = run(body(GOOD_REVIEW, 'Chrome: n/a — no UI files changed'), UI);
        expect(failedIds(r)).toEqual(['chrome']);
        expect(r.rules.find((x) => x.id === 'chrome')?.detail).toContain('UI files changed');
    });
    it('accepts n/a only with the standard wording', () => {
        expect(failedIds(run(body(GOOD_REVIEW, 'Chrome: n/a — because')))).toEqual(['chrome']);
    });
    it('fails an observation shorter than 15 characters', () => {
        expect(failedIds(run(body(GOOD_REVIEW, 'Chrome: /team — light ok'), UI))).toEqual(['chrome']);
    });
    it('requires light to be named', () => {
        expect(failedIds(run(body(GOOD_REVIEW, 'Chrome: /team — dialog renders and submits fine'), UI))).toEqual(['chrome']);
    });
    it('requires light and dark', () => {
        const eng = (c: string) => checkPrReadiness({ body: body(GOOD_REVIEW, c), isDraft: false, files: ['app/routes/x.tsx'], repoKind: 'engine' });
        expect(eng('Chrome: /inspections — list renders, light checked').ok).toBe(false);
        expect(eng('Chrome: /inspections — list renders, light and dark checked').ok).toBe(true);
        expect(eng('Chrome: /inspections — list renders in light; dark: n/a no styling change').ok).toBe(true);
        expect(eng('Chrome: /inspections — list renders in light; dark: n/a').ok).toBe(false);
    });
    it('UI paths include messages/ and public/', () => {
        const eng = (f: string) => checkPrReadiness({ body: body(GOOD_REVIEW, 'Chrome: n/a — no UI files changed'), isDraft: false, files: [f], repoKind: 'engine' }).ok;
        expect(eng('messages/en/x.json')).toBe(false);
        expect(eng('public/a.svg')).toBe(false);
        expect(eng('server/x.ts')).toBe(true);
        expect(run(body(GOOD_REVIEW, 'Chrome: n/a — no UI files changed'), ['app/styles/x.css']).ok).toBe(false);
        expect(run(body(GOOD_REVIEW, 'Chrome: n/a — no UI files changed'), ['app/routes/__tests__/x.test.tsx']).ok).toBe(true);
    });
});

describe('rule d: placeholders', () => {
    it.each(['TBD', 'TODO later', '<n>', '<what was seen>'])('rejects %s', (junk) => {
        const r = run(body(GOOD_REVIEW, 'Chrome: n/a — no UI files changed', `Notes: ${junk}`));
        expect(failedIds(r)).toEqual(['placeholders']);
    });
    it('rejects "lgtm" as the whole content', () => {
        const r = run('## Verification\nlgtm');
        expect(failedIds(r)).toContain('placeholders');
    });
    it('rejects "looks fine" as the observation', () => {
        expect(failedIds(run(body(GOOD_REVIEW, 'Chrome: /team — looks fine'), UI))).toContain('chrome');
    });
    it('rejects the unedited template', () => {
        const r = run(body('Code review: <reviewer> — open findings: <n>', 'Chrome: /<route> — <what was seen, light and dark>'), UI);
        expect(r.ok).toBe(false);
        expect(failedIds(r)).toEqual(expect.arrayContaining(['code-review', 'placeholders']));
    });
});

describe('rule e: draft', () => {
    it('fails while a draft, with the specified message', () => {
        const r = run(body(GOOD_REVIEW, 'Chrome: n/a — no UI files changed'), NO_UI, { isDraft: true });
        expect(failedIds(r)).toEqual(['not-draft']);
        expect(r.rules[0].detail).toBe('Draft PR: mark ready only after review and Chrome verification are recorded');
    });
    it('is skipped for a merged PR', () => {
        expect(run(body(GOOD_REVIEW, 'Chrome: n/a — no UI files changed'), NO_UI, { isDraft: true, skipDraft: true }).ok).toBe(true);
    });
});

describe('empty or garbage input never reads as green', () => {
    it.each([['', 'empty'], ['\u0000\u0001 ## ', 'garbage'], [null, 'null'], [undefined, 'undefined']] as [string | null | undefined, string][])('%j (%s)', (b) => {
        const r = checkPrReadiness({ body: b, isDraft: false, files: [], repoKind: 'engine' });
        expect(r.ok).toBe(false);
        expect(r.checked).toBe(5);
        expect(r.failed).toBeGreaterThan(0);
    });
});

describe('checkCommitPr (the deploy-gate path), with a fake gh', () => {
    const fakeGh = (prBody: string, files: string[], merged = true) => (args: string[]) => {
        const url = args[1];
        if (url.endsWith('/pulls') && url.includes('/commits/')) return JSON.stringify([{ number: 7, merged_at: merged ? 'x' : null, state: merged ? 'closed' : 'open', head: { sha: 'abc' } }]);
        if (url.endsWith('/pulls/7/files')) return files.join('\n');
        if (url.endsWith('/pulls/7')) return JSON.stringify({ body: prBody, draft: true, merged_at: merged ? 'x' : null });
        throw new Error(`unexpected ${url}`);
    };
    it('refuses a PR whose body lacks the block, naming the rule', () => {
        const r = checkCommitPr({ sha: 'abc', repoKind: 'engine', gh: fakeGh('just text', NO_UI) });
        expect('ok' in r && r.ok).toBe(false);
        expect(failedIds(r)).toEqual(expect.arrayContaining(['verification-section', 'code-review']));
    });
    it('accepts a PR with the block (draft flag ignored for a merged PR)', () => {
        const r = checkCommitPr({ sha: 'abc', repoKind: 'engine', gh: fakeGh(body(GOOD_REVIEW, 'Chrome: n/a — no UI files changed'), NO_UI) });
        expect('ok' in r && r.ok).toBe(true);
    });
    it('reports when no PR is behind the commit', () => {
        const r = checkCommitPr({ sha: 'abc', repoKind: 'engine', gh: () => '[]' });
        expect(r).toMatchObject({ noPr: true });
    });
});
