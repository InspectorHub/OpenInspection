/**
 * Unit tests for the i18n glossary gate's PARSER
 * (`scripts/check-i18n-glossary.mjs`).
 *
 * The catalogue checks this gate performs are only as real as the number of
 * rows that reached them, and a markdown parser handed a slightly different
 * document does not throw — it silently reads less and then reports OK. Every
 * historical failure of this gate was of that shape:
 *
 *   - a global `MIN_BANNED_TERMS = 15` floor sat exactly one below the count
 *     left after deleting the entire usted/tu enforcement table, so deleting it
 *     printed OK;
 *   - a marker searched the whole rest of the document for a table, so one
 *     marker placed above a three-column table whose third column is "Why"
 *     banned `Empresa`, an approved translation used in 99 keys;
 *   - columns were bound by position, so any four-column table parsed;
 *   - the approved-translation column was parsed and then used only inside an
 *     error string, so nothing could contradict it.
 *
 * So these tests are all of one kind: feed the parser a document that is wrong
 * in a specific way and assert it COMPLAINS. A parser that returns fewer rows
 * without complaining is the bug.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');

type Section = { rows: unknown[]; banned: { term: string }[] };
type Parsed = {
    sections: Map<string, Section>;
    banned: { term: string }[];
    literals: { literal: string }[];
    divergence: Set<string>;
};

let parseGlossary: (text: string, fail: (m: string) => void) => Parsed;
let proseComplaint: (term: string) => string | null;
let bannedMatcher: (term: string) => RegExp;
let buildBaseline: (p: Parsed) => { sections: Record<string, { rows: number; banned: number }>; literals: number; divergences: number };
let diffBaseline: (
    current: ReturnType<typeof buildBaseline>,
    baseline: unknown,
) => { violations: string[]; loosened: string[] };

beforeAll(async () => {
    const scriptPath = path.resolve(REPO, 'scripts/check-i18n-glossary.mjs');
    ({ parseGlossary, proseComplaint, bannedMatcher, buildBaseline, diffBaseline } = await import(
        /* @vite-ignore */ pathToFileURL(scriptPath).href
    ));
});

/** Collects complaints so a test can assert on what the parser objected to. */
const parse = (text: string) => {
    const errors: string[] = [];
    const result = parseGlossary(text, (m) => errors.push(m));
    return { result, errors };
};

const TERMS_TABLE = [
    '<!-- gate:terms -->',
    '',
    '| English | es-419 | Never | Why |',
    '|---|---|---|---|',
    '| Report | informe | reporte | The canonical noun. |',
    '| Template | plantilla | — | Standard software Spanish. |',
].join('\n');

const LITERAL_TABLE = [
    '<!-- gate:literal -->',
    '',
    '| Literal | Where it appears | Why it stays English |',
    '|---|---|---|',
    '| `STOP` | SMS consent copy | Carriers match it. |',
].join('\n');

const DIVERGENCE = ['<!-- gate:divergence -->', '', '- `key_one`, `key_two` — a reason.'].join('\n');

/** A minimal document the parser should accept without a single complaint. */
const goodDoc = (terms = TERMS_TABLE) =>
    ['# Glossary', '', '## Product nouns', '', terms, '', '## Literals', '', LITERAL_TABLE, '', '## Consistency', '', DIVERGENCE, ''].join('\n');

describe('parseGlossary — the happy path it must not be stricter than', () => {
    it('accepts a well-formed document and reads every part of it', () => {
        const { result, errors } = parse(goodDoc());
        expect(errors).toEqual([]);
        expect([...result.sections.keys()]).toEqual(['Product nouns']);
        expect(result.sections.get('Product nouns')!.rows).toHaveLength(2);
        expect(result.banned.map((b) => b.term)).toEqual(['reporte']);
        expect(result.literals.map((l) => l.literal)).toEqual(['STOP']);
        expect([...result.divergence]).toEqual(['key_one', 'key_two']);
    });

    it('treats an em dash in the Never column as "nothing is banned here", not as a term', () => {
        const { result } = parse(goodDoc());
        expect(result.banned).toHaveLength(1);
    });
});

describe('marker anchoring — a marker may only claim the table directly beneath it', () => {
    it('rejects a marker separated from its table by prose', () => {
        const strayed = TERMS_TABLE.replace(
            '<!-- gate:terms -->\n\n|',
            '<!-- gate:terms -->\n\nA paragraph that should not be here.\n\n|',
        );
        const { errors } = parse(goodDoc(strayed));
        expect(errors.join('\n')).toMatch(/is not a table header/);
    });

    it('rejects a marker with nothing after it at all', () => {
        const { errors } = parse(['## Product nouns', '', '<!-- gate:terms -->', ''].join('\n'));
        expect(errors.join('\n')).toMatch(/is not a table header/);
    });

    it('does not treat the marker name quoted in prose as a marker', () => {
        // The glossary documents its own markers; a loose text search finds the
        // mention before the real thing and reads the wrong paragraph. This is
        // not hypothetical — it silently zeroed the divergence list once.
        const doc = ['## Intro', '', 'The `<!-- gate:divergence -->` marker declares exceptions.', '', '- `not_a_real_key` — prose bullet.', '', goodDoc()].join('\n');
        const { result, errors } = parse(doc);
        expect(errors).toEqual([]);
        expect([...result.divergence]).toEqual(['key_one', 'key_two']);
    });

    it('counts markers against tables so a marker that yielded nothing is named', () => {
        const doc = [goodDoc(), '', '## Orphan', '', '<!-- gate:terms -->', '', 'no table here', ''].join('\n');
        const { errors } = parse(doc);
        expect(errors.join('\n')).toMatch(/marker\(s\) but 1 table\(s\) parsed/);
    });
});

describe('header binding — columns are bound by name, never by position', () => {
    it('rejects a three-column table even though its first two columns line up', () => {
        // The exact latent defect: a "database seeds" table whose third column is
        // "Why". Parsed by position it bans a paragraph of English prose and the
        // approved translation `Empresa`.
        const seeds = [
            '<!-- gate:terms -->',
            '',
            '| English | es-419 | Why |',
            '|---|---|---|',
            '| Title Company | Empresa de títulos | Consistent with the Company row. |',
        ].join('\n');
        const { errors } = parse(goodDoc(seeds));
        expect(errors.join('\n')).toMatch(/table header is \[English \| es-419 \| Why\]/);
    });

    it('rejects a four-column table whose Never column is called something else', () => {
        const renamed = TERMS_TABLE.replace('| Never |', '| Forbidden |');
        const { errors } = parse(goodDoc(renamed));
        expect(errors.join('\n')).toMatch(/expected exactly \[English \| es-419 \| Never \| Why\]/);
    });

    it('rejects a gate:literal table with the term-table header', () => {
        const wrong = LITERAL_TABLE.replace(
            '| Literal | Where it appears | Why it stays English |',
            '| English | es-419 | Never |',
        );
        const { errors } = parse(goodDoc().replace(LITERAL_TABLE, wrong));
        expect(errors.join('\n')).toMatch(/expected exactly \[Literal \| Where it appears \| Why it stays English\]/);
    });
});

describe('row shape — a table that yields nothing must say so', () => {
    it('rejects a row with fewer columns than the header declares', () => {
        const short = TERMS_TABLE.replace('| Template | plantilla | — | Standard software Spanish. |', '| Template | plantilla | — |');
        const { errors } = parse(goodDoc(short));
        expect(errors.join('\n')).toMatch(/has 3 column\(s\), header declares 4/);
    });

    it('rejects a row with more columns than the header declares', () => {
        const long = TERMS_TABLE.replace('| Template | plantilla | — | Standard software Spanish. |', '| Template | plantilla | — | why | extra |');
        const { errors } = parse(goodDoc(long));
        expect(errors.join('\n')).toMatch(/has 5 column\(s\), header declares 4/);
    });

    it('rejects a marked table with a header and no data rows', () => {
        const empty = ['<!-- gate:terms -->', '', '| English | es-419 | Never | Why |', '|---|---|---|---|'].join('\n');
        const { errors } = parse(goodDoc(empty));
        expect(errors.join('\n')).toMatch(/zero data rows/);
    });

    it('rejects two gate:terms tables sharing one heading, because the baseline is keyed by heading', () => {
        const { errors } = parse(goodDoc(`${TERMS_TABLE}\n\n${TERMS_TABLE}`));
        expect(errors.join('\n')).toMatch(/a second gate:terms table under the heading/);
    });
});

describe('the approved column is load-bearing', () => {
    it('rejects a row that fixes no es-419 equivalent', () => {
        const blank = TERMS_TABLE.replace('| Report | informe |', '| Report | — |');
        const { errors } = parse(goodDoc(blank));
        expect(errors.join('\n')).toMatch(/row "Report" has no approved es-419 value/);
    });

    it("rejects a banned term that is some row's approved translation", () => {
        const clash = TERMS_TABLE.replace('| Template | plantilla | — |', '| Template | plantilla | informe |');
        const { errors } = parse(goodDoc(clash));
        expect(errors.join('\n')).toMatch(/it is also the APPROVED translation/);
    });

    it('compares approved forms accent- and case-insensitively, and splits "a / b" pairs', () => {
        const pair = TERMS_TABLE.replace(
            '| Template | plantilla | — | Standard software Spanish. |',
            '| Possessive | su / sus | SU | The usted possessive. |',
        );
        const { errors } = parse(goodDoc(pair));
        expect(errors.join('\n')).toMatch(/it is also the APPROVED translation/);
    });
});

describe('proseComplaint — prose in the Never column is a junk regex that pads the floor', () => {
    it.each([
        ['tu'],
        ['tus'],
        ['Ud.'],
        ['Vd.'],
        ['orden de trabajo'],
        ['iniciar la sesión'],
        ['comentario enlatado'],
    ])('accepts the real banned term %j', (term) => {
        expect(proseComplaint(term)).toBeNull();
    });

    it.each([
        ['Never use this word because it collides with something else.', /longer than 40/],
        ['one two three four five', /more than four words/],
        ['Empresa — not compañía', /contains/],
        ['note: compañía', /contains/],
        ['abbrev.iated', /mid-string period/],
        ['a sentence ending here.', /ends in a period/],
    ])('rejects %j', (term, expected) => {
        expect(proseComplaint(term)).toMatch(expected);
    });
});

describe('diffBaseline — the ratchet only ever tightens', () => {
    const baseline = { sections: { A: { rows: 5, banned: 2 }, B: { rows: 3, banned: 1 } }, literals: 4, divergences: 2 };

    it('fails when a whole section disappears, whatever the totals say', () => {
        // This is the FG-2 shape exactly: the surviving sections could easily
        // still satisfy any global floor.
        const current = { sections: { A: { rows: 99, banned: 99 } }, literals: 4, divergences: 2 };
        const { violations } = diffBaseline(current, baseline);
        expect(violations.join('\n')).toMatch(/section "B" is gone/);
    });

    it('fails when one section loses rows or banned terms while others grow', () => {
        const current = { sections: { A: { rows: 50, banned: 50 }, B: { rows: 3, banned: 0 } }, literals: 4, divergences: 2 };
        const { violations } = diffBaseline(current, baseline);
        expect(violations.join('\n')).toMatch(/section "B": 0 banned term\(s\), baseline 1/);
    });

    it('fails when the literal or divergence count drops', () => {
        const current = { sections: baseline.sections, literals: 3, divergences: 1 };
        const { violations } = diffBaseline(current, baseline);
        expect(violations.join('\n')).toMatch(/3 do-not-translate literal\(s\), baseline 4/);
        expect(violations.join('\n')).toMatch(/1 declared divergence\(s\), baseline 2/);
    });

    it('passes and merely suggests re-baselining when the glossary grows', () => {
        const current = { sections: { A: { rows: 6, banned: 2 }, B: { rows: 3, banned: 1 }, C: { rows: 1, banned: 0 } }, literals: 9, divergences: 2 };
        const { violations, loosened } = diffBaseline(current, baseline);
        expect(violations).toEqual([]);
        expect(loosened).toContain('C (new)');
        expect(loosened).toContain('literals');
    });
});

describe('bannedMatcher — whole word, optional plural, accent-blind', () => {
    it.each([
        ['reporte', 'ver el reporte', true],
        ['reporte', 'ver los reportes', true],
        ['tu', 'tu casa', true],
        ['tu', 'tú casa', true],       // normalised before matching
        ['tu', 'atun fresco', false],  // must not match inside a word
        ['te', 'te enviamos', true],
        ['te', 'comité de obra', false],
    ])('%j against %j → %s', (term, haystack, expected) => {
        const normalised = [...haystack.normalize('NFD')]
            .filter((ch) => {
                const cp = ch.codePointAt(0)!;
                return cp < 0x0300 || cp > 0x036f;
            })
            .join('')
            .toLowerCase();
        expect(bannedMatcher(term).test(normalised)).toBe(expected);
    });
});

describe('the real glossary', () => {
    it('parses with zero complaints', () => {
        const text = readFileSync(path.resolve(REPO, 'docs/develop/conventions/i18n-glossary.md'), 'utf8');
        const { errors } = parse(text);
        expect(errors).toEqual([]);
    });

    it('matches its committed baseline exactly, so a drift shows up here too', () => {
        const text = readFileSync(path.resolve(REPO, 'docs/develop/conventions/i18n-glossary.md'), 'utf8');
        const { result } = parse(text);
        const committed = JSON.parse(readFileSync(path.resolve(REPO, 'scripts/i18n-glossary-baseline.json'), 'utf8'));
        expect(buildBaseline(result)).toEqual(committed);
    });

    it('still enforces the register section a global floor once let vanish', () => {
        const text = readFileSync(path.resolve(REPO, 'docs/develop/conventions/i18n-glossary.md'), 'utf8');
        const { result } = parse(text);
        const register = result.sections.get('Register enforcement');
        expect(register).toBeDefined();
        expect(register!.banned.map((b) => b.term)).toEqual(
            expect.arrayContaining(['tu', 'tus', 'vosotros', 'ordenador', 'fichero']),
        );
    });
});
