// @ts-expect-error -- plain .mjs helper, no types alongside it (same as the other tooling specs).
import * as mod from '../../../scripts/pr-readiness.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

type Rule = { id: string; ok: boolean; detail: string; example?: string };
type Res = { ok: boolean; checked: number; failed: number; rules: Rule[] };
const checkPrReadiness = mod.checkPrReadiness as (a: Record<string, unknown>) => Res;
const extractVerification = mod.extractVerification as (b: string) => string | null;
const isUiFile = mod.isUiFile as (f: string) => boolean;
const expandPaths = mod.expandPaths as (f: unknown[]) => string[];
const formatReport = mod.formatReport as (r: Res) => string;
const parseFilesNdjson = mod.parseFilesNdjson as (t: string) => string[];
const fetchPrFiles = mod.fetchPrFiles as (repo: string, n: number, gh: (a: string[]) => string) => string[];
const FILES_JQ = mod.FILES_JQ as string;

const TOKENS = 'light: ok, dark: ok';
const GOOD_REVIEW = 'Code review: independent reviewer agent pass 2 — open findings: 0';
const GOOD_CHROME = `Chrome: /company/acme/team — ${TOKENS} — invite dialog renders and submits`;
const THEMES_FOR_TEST = (tok: string) => tok;
const chrome = (tok: string, seen = 'renders the invite dialog fine') => `Chrome: /team — ${tok} — ${seen}`;
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
        ['parenthetical', 'Code review: independent reviewer agent pass — open findings: 0 (none)'],
        ['backticked', '`Code review:` independent reviewer agent pass — open findings: 0'],
    ])('review line: %s', (_n, line) => {
        expect(failedIds(run(body(line, NA)))).toEqual([]);
    });
    it('chrome line with bold, backticked route and blockquote', () => {
        expect(run(body(GOOD_REVIEW, `> **Chrome:** \`/inspections\` — ${TOKENS} — list renders and filters`), UI).ok).toBe(true);
    });
    it('chrome line with a colon separator', () => {
        expect(run(body(GOOD_REVIEW, `Chrome: /inspections: ${TOKENS} — list renders and filters`), UI).ok).toBe(true);
    });
    it('CRLF bodies and a trailing lone CR', () => {
        const crlf = body(GOOD_REVIEW, NA).replace(/\n/g, '\r\n') + '\r';
        expect(run(crlf).ok).toBe(true);
    });
    it('does not reject <details>, <br>, Array<string> or /inspections/<id> as placeholders', () => {
        const r = run(body(GOOD_REVIEW, `Chrome: /inspections/<id> — ${TOKENS} — page renders for Array<string> items`, '<details><summary>log</summary>ok<br></details>'), UI);
        expect(failedIds(r)).toEqual([]);
    });
});

describe('rule a: Verification section', () => {
    it('an inline <!-- inside backticks before the heading does not truncate the body (L5)', () => {
        const b = 'Notes: the `<!--` opener is escaped here.\n## Verification\n' + GOOD_REVIEW + '\n' + NA;
        expect(extractVerification(b)).toContain('Code review');
        expect(run(b).ok).toBe(true);
    });
    it('a real unclosed opener still drops the rest', () => {
        expect(extractVerification('text <!-- oops\n## Verification\nx')).toBeNull();
    });
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
    it.each(['(3 unresolved)', '(2 blocking)', '(pending)', '(remaining work)', '(open: 1)', '(2 of them)', '(see item 4)', '(nine)', '(see below: three issues)', '(a few)'])('rejects a contradicting parenthetical %s', (p) => {
        expect(failedIds(run(body(`Code review: independent reviewer agent pass — open findings: 0 ${p}`, NA)))).toEqual(['code-review']);
    });
    it.each(['(none)', '(zero)', '(all fixed)', '(nothing left)', '(NONE)'])('accepts the parenthetical %s', (p) => {
        expect(failedIds(run(body(`Code review: independent reviewer agent pass — open findings: 0 ${p}`, NA)))).toEqual([]);
    });
    it.each(['self', 'myself', 'author', 'me', 'own', 'same'])('rejects the self word "%s" on its own (mutation control)', (t) => {
        expect(failedIds(run(body(`Code review: independent ${t} pass — open findings: 0`, NA)))).toEqual(['code-review']);
    });
    it.each(['Homer', 'Owen', 'sameness', 'selfie', 'authority', 'mess'])('does not reject the look-alike word "%s"', (t) => {
        expect(failedIds(run(body(`Code review: independent ${t} pass — open findings: 0`, NA)))).toEqual([]);
    });
    it('the self-word message tells the author how to fix it', () => {
        const r = run(body('Code review: Same Day Review Bot — open findings: 0', NA));
        expect(failedIds(r)).toEqual(['code-review']);
        expect(r.rules.find((x) => x.id === 'code-review')?.detail).toContain('clarifying word');
    });
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
    it('passes the token form', () => {
        expect(run(body(GOOD_REVIEW, GOOD_CHROME), UI).ok).toBe(true);
    });
    it('fails an observation shorter than 15 characters after the last dash', () => {
        expect(failedIds(run(body(GOOD_REVIEW, chrome(TOKENS, 'ok fine')), UI))).toEqual(['chrome']);
        expect(run(body(GOOD_REVIEW, chrome(TOKENS, 'exactly fifteen!')), UI).ok).toBe(true);
    });
    it('the route must start with a slash', () => {
        expect(failedIds(run(body(GOOD_REVIEW, `Chrome: team — ${TOKENS} — renders the invite dialog fine`), UI))).toEqual(['chrome']);
    });
    it('fails "looks fine" as the observation', () => {
        expect(failedIds(run(body(GOOD_REVIEW, chrome(TOKENS, 'looks fine')), UI))).toEqual(['chrome']);
    });
    it('a failing line shows the required form', () => {
        const r = run(body(GOOD_REVIEW, 'Chrome: /team — it works in the browser'), UI);
        expect(r.rules.find((x) => x.id === 'chrome')?.detail).toContain('light: ok');
    });
    it('tokens are case-insensitive, in any order, separated by comma, semicolon or space', () => {
        for (const tok of ['LIGHT: OK, DARK: OK', 'dark: ok light: ok', 'light:ok; dark:ok', 'dark: ok, light: ok.'])
            expect(run(body(GOOD_REVIEW, chrome(THEMES_FOR_TEST(tok))), UI).ok).toBe(true);
    });
    it.each(['light: not checked', 'light: skipped', 'light: pending', 'light: untested', 'light: no', 'lightbox: ok', 'dark: ok'])(
        'a bad light value fails: %s',
        (tok) => {
            expect(failedIds(run(body(GOOD_REVIEW, chrome(tok)), UI))).toEqual(['chrome']);
        },
    );
    it('evaluates EVERY Chrome line: one bad line fails the rule even beside a good one', () => {
        expect(failedIds(run(body(GOOD_REVIEW, GOOD_CHROME, 'Chrome: see above'), UI))).toEqual(['chrome']);
        expect(failedIds(run(body(GOOD_REVIEW, GOOD_CHROME, chrome('light: skipped')), UI))).toEqual(['chrome']);
        expect(run(body(GOOD_REVIEW, GOOD_CHROME, GOOD_CHROME), UI).ok).toBe(true);
    });
    it.each([
        'light ok; not dark',
        'light ok, dark not checked',
        'dark mode untested',
        'light ok; dark skipped',
        'dark n/a',
        'light and dark not verified yet',
        'unverified: light and dark',
        'skipped the empty state, checked light and dark',
        'checked light and dark; no layout shift, nothing skipped',
        'Not seen any problem in light and dark',
        'light and dark checked',
        'did not check',
        'pending',
        'to be tested',
        'will test later',
    ])('free text without the tokens fails: %s', (txt) => {
        expect(failedIds(run(body(GOOD_REVIEW, `Chrome: /team — ${txt} — renders the invite dialog fine`), UI))).toEqual(['chrome']);
        expect(failedIds(run(body(GOOD_REVIEW, `Chrome: /team — ${txt}`), UI))).toEqual(['chrome']);
    });
    it.each(['light: ok, dark: not checked', 'light: ok, dark: skipped', 'light: ok, dark: pending', 'light: ok, dark: untested', 'light: ok, dark: no', 'light: ok', 'dark: ok, light: skipped'])(
        'engine: fails %s',
        (tok) => {
            expect(failedIds(run(body(GOOD_REVIEW, chrome(tok)), UI))).toEqual(['chrome']);
        },
    );
    it('engine: dark: n/a needs a reason of at least 4 words in parentheses', () => {
        const eng = (tok: string) => run(body(GOOD_REVIEW, chrome(tok)), UI).ok;
        expect(eng('light: ok, dark: ok')).toBe(true);
        expect(eng('light: ok, dark: n/a (this view has no dark theme styling at all)')).toBe(true);
        expect(eng('dark: n/a (this view has no dark theme styling), light: ok')).toBe(true);
        expect(eng('light: ok, dark: n/a')).toBe(false);
        expect(eng('light: ok, dark: n/a (no styles)')).toBe(false);
        expect(eng('light: ok, dark: n/a no dark styling because plain page')).toBe(false);
        expect(eng('light: ok, dark: n/a (this view has no dark theme styling), dark: skipped')).toBe(false);
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
    it.each(['__mocks__/x.tsx', 'app/components/Button.stories.tsx', 'server/data/seed.json', 'server/generated/api.json', 'app/routes/__mocks__/y.ts'])(
        'clearly non-UI path: %s',
        (f) => expect(isUiFile(f)).toBe(false),
    );
    it('tailwind and vite config stay UI (they restyle or rebuild every screen)', () => {
        expect(isUiFile('tailwind.config.ts')).toBe(true);
        expect(isUiFile('vite.config.ts')).toBe(true);
    });
    it('a PR with ZERO changed files cannot claim Chrome n/a (L7)', () => {
        const r = run(body(GOOD_REVIEW, NA), []);
        expect(failedIds(r)).toEqual(['chrome']);
        expect(r.rules.find((x) => x.id === 'chrome')?.detail).toContain('ZERO');
    });
    it('parseFilesNdjson / fetchPrFiles keep the old path of a rename (previous_filename)', () => {
        const nd = [JSON.stringify({ filename: 'docs/new.md', previous_filename: 'app/routes/old.tsx' }), JSON.stringify({ filename: 'a.ts', previous_filename: null })].join('\n');
        expect(parseFilesNdjson(nd)).toEqual(['docs/new.md', 'app/routes/old.tsx', 'a.ts']);
        let seen: string[] = [];
        const paths = fetchPrFiles('o/r', 9, (args) => {
            seen = args;
            return nd;
        });
        expect(paths).toContain('app/routes/old.tsx');
        expect(seen.join(' ')).toContain('pulls/9/files');
        expect(FILES_JQ).toContain('previous_filename');
        expect(FILES_JQ).toContain('tojson');
        expect(parseFilesNdjson('')).toEqual([]);
    });
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
        const r = run(body('Code review: <reviewer> — open findings: <n>', 'Chrome: /<route> — light: ok, dark: ok — <what was seen>'), UI);
        expect(r.ok).toBe(false);
        expect(failedIds(r)).toEqual(expect.arrayContaining(['code-review', 'placeholders']));
    });
});

describe('the real PR template', () => {
    const TEMPLATE = '.github/PULL_REQUEST_TEMPLATE.md';
    const text = readFileSync(join(process.cwd(), TEMPLATE), 'utf8');
    it('fails verbatim, so an unedited template cannot merge', () => {
        const r = run(text, UI);
        expect(r.ok).toBe(false);
        expect(failedIds(r)).toEqual(expect.arrayContaining(['code-review', 'placeholders']));
        expect(run(text, NO_UI).ok).toBe(false);
    });
    it('passes once the two placeholder lines are filled in', () => {
        const filled = text.replace(/^Code review:.*$/m, GOOD_REVIEW).replace(/^Chrome:.*$/m, GOOD_CHROME);
        expect(failedIds(run(filled, UI))).toEqual([]);
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
