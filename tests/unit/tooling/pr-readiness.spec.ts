// @ts-expect-error -- plain .mjs helper, no types alongside it (same as the other tooling specs).
import * as mod from '../../../scripts/pr-readiness.mjs';
import { describe, it, expect } from 'vitest';

type Rule = { id: string; ok: boolean; detail: string; example?: string };
type Res = { ok: boolean; checked: number; failed: number; rules: Rule[] };
const checkPrReadiness = mod.checkPrReadiness as (a: Record<string, unknown>) => Res;
const extractVerification = mod.extractVerification as (b: string) => string | null;
const isUiFile = mod.isUiFile as (f: string) => boolean;
const expandPaths = mod.expandPaths as (f: unknown[]) => string[];
const formatReport = mod.formatReport as (r: Res) => string;

const THEME_TEXT = 'light and dark checked';
const GOOD_REVIEW = 'Code review: independent reviewer agent pass 2 — open findings: 0';
const GOOD_CHROME = `Chrome: /company/acme/team — invite dialog renders, ${THEME_TEXT}`;
const NA = 'Chrome: n/a — no UI files changed';
const UI = ['app/routes/team.tsx'];
const NO_UI = ['server/lib/foo.ts', 'docs/x.md'];

const body = (...lines: string[]) => ['## Summary', 'x', '', '## Verification', ...lines, '', '## Notes', 'y'].join('\n');
const run = (b: unknown, files: unknown[] = NO_UI, extra: Record<string, unknown> = {}) =>
    checkPrReadiness({ body: b, isDraft: false, files, ...extra });
const failedIds = (r: Res) => r.rules.filter((x) => !x.ok).map((x) => x.id);

describe('happy paths', () => {
    it('passes a complete UI-free record', () => {
        const r = run(body(GOOD_REVIEW, NA));
        expect(failedIds(r)).toEqual([]);
        expect(r.ok).toBe(true);
        expect(r.checked).toBe(5);
        expect(r.failed).toBe(0);
    });
    it('passes a complete UI record', () => {
        expect(run(body(GOOD_REVIEW, GOOD_CHROME), UI).ok).toBe(true);
    });
    it('accepts -, em dash, -- and U+2212 separators in the review line', () => {
        for (const sep of ['-', '—', '--', '−', ':'])
            expect(run(body(`Code review: independent agent review pass ${sep} open findings: 0`, NA)).ok).toBe(true);
    });
    it('ignores HTML comments in the template', () => {
        expect(run(body('<!-- <reviewer> goes here -->', GOOD_REVIEW, NA)).ok).toBe(true);
    });
});

describe('formatting tolerance (M3)', () => {
    it.each([
        ['bold label', '**Code review:** independent reviewer agent pass — open findings: 0'],
        ['bullet + bold', '- **Code review:** independent reviewer agent pass — open findings: 0'],
        ['bold with colon outside', '**Code review**: independent reviewer agent pass — open findings: 0'],
        ['blockquote', '> Code review: independent reviewer agent pass — open findings: 0'],
        ['numbered', '1. Code review: independent reviewer agent pass — open findings: 0'],
        ['trailing dot', 'Code review: independent reviewer agent pass — open findings: 0.'],
        ['parenthetical', 'Code review: independent reviewer agent pass — open findings: 0 (none left)'],
        ['backticked', '`Code review:` independent reviewer agent pass — open findings: 0'],
    ])('review line: %s', (_n, line) => {
        expect(failedIds(run(body(line, NA)))).toEqual([]);
    });
    it('chrome line with bold, backticked route and blockquote', () => {
        expect(run(body(GOOD_REVIEW, `> **Chrome:** \`/inspections\` — list renders, ${THEME_TEXT}`), UI).ok).toBe(true);
    });
    it('chrome line with a colon separator', () => {
        expect(run(body(GOOD_REVIEW, `Chrome: /inspections: list renders, ${THEME_TEXT}`), UI).ok).toBe(true);
    });
    it('CRLF bodies and a trailing lone CR', () => {
        const crlf = body(GOOD_REVIEW, NA).replace(/\n/g, '\r\n') + '\r';
        expect(run(crlf).ok).toBe(true);
    });
    it('does not reject <details>, <br>, Array<string> or /inspections/<id> as placeholders', () => {
        const r = run(body(GOOD_REVIEW, `Chrome: /inspections/<id> — page renders for Array<string> items, ${THEME_TEXT}`, '<details><summary>log</summary>ok<br></details>'), UI);
        expect(failedIds(r)).toEqual([]);
    });
});

describe('rule a: Verification section', () => {
    it('fails without the heading and names the exact heading', () => {
        const r = run('## Summary\nnothing');
        expect(failedIds(r)).toContain('verification-section');
        expect(r.rules[1].detail).toContain('## Verification');
    });
    it('fails for an empty section', () => {
        expect(failedIds(run('## Verification\n\n## Next\nx'))).toContain('verification-section');
    });
    it('extracts only up to the next level-2 heading', () => {
        expect(extractVerification(body('a'))).toBe('a\n');
    });
    it('does not find a heading inside a fenced code block', () => {
        const b = ['```', '## Verification', GOOD_REVIEW, NA, '```'].join('\n');
        expect(extractVerification(b)).toBeNull();
    });
    it('does not find a heading after an unclosed comment opener', () => {
        expect(extractVerification(`<!-- oops\n## Verification\n${GOOD_REVIEW}`)).toBeNull();
    });
});

describe('rule b: code review line', () => {
    it('fails with open findings above zero', () => {
        expect(failedIds(run(body('Code review: independent reviewer agent — open findings: 2', NA)))).toEqual(['code-review']);
    });
    it('gives a specific message for "0 of 12"', () => {
        const r = run(body('Code review: independent reviewer agent — open findings: 0 of 12', NA));
        expect(failedIds(r)).toEqual(['code-review']);
        expect(r.rules.find((x) => x.id === 'code-review')?.detail).toContain('exactly 0');
    });
    it('fails with open findings n/a', () => {
        expect(failedIds(run(body('Code review: independent reviewer agent — open findings: n/a', NA)))).toEqual(['code-review']);
    });
    it('fails with a reviewer under three words', () => {
        expect(failedIds(run(body('Code review: Bob — open findings: 0', NA)))).toEqual(['code-review']);
    });
    it('fails a repeated single word ("none none none")', () => {
        expect(failedIds(run(body('Code review: none none none — open findings: 0', NA)))).toEqual(['code-review']);
    });
    it.each(['self', 'self-review', 'author', 'self review by author', 'the author', 'reviewed by myself ok', 'my own review pass', 'same person as author'])(
        'rejects the self-check reviewer "%s"',
        (who) => {
            expect(failedIds(run(body(`Code review: ${who} — open findings: 0`, NA)))).toEqual(['code-review']);
        },
    );
    it('rejects two different numbers on one line (L1)', () => {
        const r = run(body('Code review: Jane Doe Smith — open findings: 3 — open findings: 0', NA));
        expect(failedIds(r)).toEqual(['code-review']);
    });
    it('evaluates EVERY Code review line (L2)', () => {
        const r = run(body(GOOD_REVIEW, 'Code review: independent reviewer agent — open findings: 4', NA));
        expect(failedIds(r)).toEqual(['code-review']);
    });
    it('fails when the line is missing', () => {
        expect(failedIds(run(body(NA)))).toEqual(['code-review']);
    });
});

describe('rule c: Chrome', () => {
    it('fails when UI files changed and there is no Chrome line', () => {
        expect(failedIds(run(body(GOOD_REVIEW), UI))).toEqual(['chrome']);
    });
    it('fails an n/a claim when UI files changed (checked against the file list)', () => {
        const r = run(body(GOOD_REVIEW, NA), UI);
        expect(failedIds(r)).toEqual(['chrome']);
        expect(r.rules.find((x) => x.id === 'chrome')?.detail).toContain('UI files changed');
    });
    it('accepts n/a only with the standard wording', () => {
        expect(failedIds(run(body(GOOD_REVIEW, 'Chrome: n/a — because')))).toEqual(['chrome']);
    });
    it('fails an observation shorter than 15 characters', () => {
        expect(failedIds(run(body(GOOD_REVIEW, 'Chrome: /team — light ok'), UI))).toEqual(['chrome']);
    });
    it('requires light to be named, as a word', () => {
        expect(failedIds(run(body(GOOD_REVIEW, 'Chrome: /team — dialog renders and submits fine'), UI))).toEqual(['chrome']);
        expect(failedIds(run(body(GOOD_REVIEW, 'Chrome: /team — lightbox renders and submits fine dark ok'), UI))).toEqual(['chrome']);
    });
    it.each(['did not check', 'not tested', "didn't verify", 'skipped the browser pass'])('rejects an observation that denies the check: %s', (d) => {
        const r = run(body(GOOD_REVIEW, `Chrome: /team — renders in light mode, ${d}`), UI);
        expect(failedIds(r)).toEqual(['chrome']);
    });
    it('evaluates every Chrome line: a denying line fails even beside a good one (L2)', () => {
        const r = run(body(GOOD_REVIEW, GOOD_CHROME, 'Chrome: /other — not tested at all, sorry'), UI);
        expect(failedIds(r)).toEqual(['chrome']);
    });
    it('a second, malformed Chrome line does not hide a good one', () => {
        expect(run(body(GOOD_REVIEW, GOOD_CHROME, 'Chrome: see above'), UI).ok).toBe(true);
    });
    it('requires dark as a word unless "dark: n/a" has a reason', () => {
        const eng = (c: string) => run(body(GOOD_REVIEW, c), UI).ok;
        expect(eng('Chrome: /inspections — list renders, light checked')).toBe(false);
        expect(eng('Chrome: /inspections — list renders, light and dark checked')).toBe(true);
        expect(eng('Chrome: /inspections — list renders in light; dark: n/a no styling change')).toBe(true);
        expect(eng('Chrome: /inspections — list renders in light; dark: n/a')).toBe(false);
        expect(eng('Chrome: /inspections — renders light ok, did not check dark')).toBe(false);
        expect(eng('Chrome: /inspections — renders light ok, darkness ahead lol')).toBe(false);
    });
});

describe('UI file detection (H1)', () => {
    it.each([
        'app/routes/x.tsx', 'app/hooks/useThing.ts', 'app/styles/tailwind.css', 'app/assets/logo.svg', 'app/data/strings.json',
        'server/features/seat-quota/seat-banner.tsx', 'server/lib/icons.tsx', 'server/styles/colors_and_type.css',
        'packages/shared-ui/src/Button.ts', 'packages/shared-ui/src/Button.tsx', 'index.html', 'tailwind.config.ts', 'vite.config.ts',
        'public/favicon.ico', 'public/a/b.woff2', 'messages/en/x.json',
    ])('UI: %s', (f) => expect(isUiFile(f)).toBe(true));
    it.each([
        'server/lib/foo.ts', 'server/api/x.ts', 'package.json', 'packages/api-types/package.json', 'tsconfig.json',
        'app/routes/x.test.tsx', 'app/components/__tests__/y.tsx', 'tests/e2e/a.spec.ts', 'tests/unit/ui/b.tsx', 'docs/readme.md',
    ])('not UI: %s', (f) => expect(isUiFile(f)).toBe(false));
    it('a rename OUT of a UI path counts: the old path is a changed path', () => {
        expect(expandPaths([{ filename: 'server/lib/foo.ts', previous_filename: 'app/routes/old.tsx' }])).toEqual(['server/lib/foo.ts', 'app/routes/old.tsx']);
        const r = run(body(GOOD_REVIEW, NA), [{ filename: 'server/lib/foo.ts', previous_filename: 'app/routes/old.tsx' }]);
        expect(failedIds(r)).toEqual(['chrome']);
    });
    it('--files-from style "old -> new" lines expand to both paths', () => {
        expect(failedIds(run(body(GOOD_REVIEW, NA), ['app/routes/old.tsx -> docs/old.md']))).toEqual(['chrome']);
    });
});

describe('rule d: placeholders', () => {
    it.each(['TBD', 'TODO later', '<n>', '<what was seen>', '<reviewer>', '<route>', '<who reviewed>'])('rejects %s', (junk) => {
        const r = run(body(GOOD_REVIEW, NA, `Notes: ${junk}`));
        expect(failedIds(r)).toEqual(['placeholders']);
    });
    it('rejects "lgtm" as the whole content', () => {
        expect(failedIds(run('## Verification\nlgtm'))).toContain('placeholders');
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
        const r = run(body(GOOD_REVIEW, NA), NO_UI, { isDraft: true });
        expect(failedIds(r)).toEqual(['not-draft']);
        expect(r.rules[0].detail).toBe('Draft PR: mark ready only after review and Chrome verification are recorded');
    });
    it('is skipped for a merged PR', () => {
        expect(run(body(GOOD_REVIEW, NA), NO_UI, { isDraft: true, skipDraft: true }).ok).toBe(true);
    });
});

describe('messages', () => {
    it('every failing rule prints a worked example', () => {
        const out = formatReport(run('nothing', UI, { isDraft: true }));
        expect(out).toContain('e.g. ## Verification');
        expect(out).toContain('e.g. Code review: independent reviewer agent pass 2 — open findings: 0');
        expect(out).toContain('e.g. Chrome: /');
        expect(out).toContain('rules checked, 5 failed');
    });
});

describe('empty or garbage input never reads as green', () => {
    it.each([['', 'empty'], ['\u0000\u0001 ## ', 'garbage'], [null, 'null'], [undefined, 'undefined']] as [string | null | undefined, string][])('%j (%s)', (b) => {
        const r = checkPrReadiness({ body: b, isDraft: false, files: [] });
        expect(r.ok).toBe(false);
        expect(r.checked).toBe(5);
        expect(r.failed).toBeGreaterThan(0);
    });
});
