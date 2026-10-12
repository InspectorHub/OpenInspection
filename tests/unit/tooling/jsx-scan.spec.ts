import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain .mjs helper, no types alongside it (same as the other tooling specs).
import { analyze, elementBody, findOpeningTags, hasAllowMarker } from '../../../scripts/lib/jsx-scan.mjs';

interface Tag { name: string; selfClosing: boolean }
// The body starts at the opening tag's closing ">"; drop it so the cases read as the element's content.
const bodyOf = (src: string, name: RegExp) => {
    const a = analyze(src);
    const tags = findOpeningTags(a, name) as Tag[];
    return tags.map((t) => (elementBody(a, t) as string).replace(/^>/, ''));
};

describe('elementBody', () => {
    it('returns the source between an element and its matching close tag, nesting included', () => {
        expect(bodyOf('<A><A>x</A>y</A>', /^A$/)).toEqual(['<A>x</A>y', 'x']);
    });
    it('is empty for a self-closing element', () => {
        expect(bodyOf('<A />', /^A$/)).toEqual(['']);
    });
    it('matches a dotted name exactly: the dot is a dot, not any character', () => {
        // A name whose dot were left unescaped would also close on </FooXBar>.
        expect(bodyOf('<Foo.Bar>one<FooXBar>two</FooXBar>three</Foo.Bar>', /^Foo\.Bar$/)).toEqual(['one<FooXBar>two</FooXBar>three']);
    });
    it('does not let a similar longer name end the element early', () => {
        expect(bodyOf('<Modal>a<ModalFooter>b</ModalFooter>c</Modal>', /^Modal$/)).toEqual(['a<ModalFooter>b</ModalFooter>c']);
    });
});

interface ScanTag {
    name: string;
    line: number;
    attrs: Array<{ name: string; value: string | null }>;
}
const tagsOf = (src: string, name: RegExp) => findOpeningTags(analyze(src), name) as ScanTag[];
const attr = (t: ScanTag | undefined, n: string) => t?.attrs.find((x) => x.name === n)?.value;
const allowed = (src: string, tagName = 'button') => {
    const a = analyze(src);
    const tag = (findOpeningTags(a, new RegExp(`^${tagName}$`)) as ScanTag[]).at(-1);
    return tag ? (hasAllowMarker(a, 'x-allow', tag) as boolean) : null;
};

describe('attribute strings that span lines', () => {
    it('reads a double-quoted className that wraps onto the next line in full', () => {
        const [t] = tagsOf('<div className="opacity-0\n group-hover:opacity-100">x</div>', /^div$/);
        expect(attr(t, 'className')).toBe('"opacity-0\n group-hover:opacity-100"');
    });
    it('reads a wrapped single-quoted value too, and keeps the attribute after it', () => {
        const [t] = tagsOf("<div title='a\n b' id=\"z\">x</div>", /^div$/);
        expect(attr(t, 'title')).toBe("'a\n b'");
        expect(attr(t, 'id')).toBe('"z"');
    });
    it('CONTROL - a JS string outside an attribute still ends at the newline, so a stray quote cannot swallow the file', () => {
        const [t] = tagsOf('const s = "oops\n<button type="submit">x</button>', /^button$/);
        expect(attr(t, 'type')).toBe('"submit"');
    });
    it('CONTROL - an unterminated attribute string falls back to ending at the newline', () => {
        const tags = tagsOf('<div title="never closed>\n<button type="submit">x</button>', /^button$/);
        expect(tags).toHaveLength(1);
    });
});

describe('allow marker', () => {
    it('honours a marker with a reason in a // comment, a block comment and a JSX comment', () => {
        expect(allowed('// x-allow: because\n<button>')).toBe(true);
        expect(allowed('/* x-allow: because */\n<button>')).toBe(true);
        expect(allowed('{/* x-allow: because */}\n<button>')).toBe(true);
    });
    it('honours a marker inside the tag itself', () => {
        expect(allowed('<button\n  // x-allow: because\n  type="submit"\n>')).toBe(true);
    });
    it('rejects a marker whose only "reason" is the comment terminator', () => {
        expect(allowed('{/* x-allow: */}\n<button>')).toBe(false);
        expect(allowed('/*x-allow:*/\n<button>')).toBe(false);
        expect(allowed('// x-allow:\n<button>')).toBe(false);
        expect(allowed('{/* x-allow: -- */}\n<button>')).toBe(false);
    });
    it('rejects marker text inside a string literal or an attribute', () => {
        expect(allowed('<button title="x-allow: because" type="submit">')).toBe(false);
        expect(allowed('const s = "x-allow: because";\n<button>')).toBe(false);
    });
    it('applies to exactly the next opening tag, not the ones after it', () => {
        const src = '{/* x-allow: because */}\n<button id="a">a</button>\n<button id="b">b</button>';
        const a = analyze(src);
        const [first, second] = findOpeningTags(a, /^button$/) as ScanTag[];
        expect(hasAllowMarker(a, 'x-allow', first)).toBe(true);
        expect(hasAllowMarker(a, 'x-allow', second)).toBe(false);
    });
    it('does not reach across a tag that sits between the marker and the target', () => {
        expect(allowed('// x-allow: because\n<div>\n<button>')).toBe(false);
    });
    it('does not reach far below the comment', () => {
        expect(allowed('// x-allow: because\n\n\n\n<button>')).toBe(false);
    });
});

describe('scanner desync', () => {
    it('does not read // in a URL inside JSX text as a comment', () => {
        const tags = tagsOf('<a>http://example.com</a><button type="submit">x</button>', /^button$/);
        expect(attr(tags[0], 'type')).toBe('"submit"');
    });
    it('does not read // after https:// as a comment either', () => {
        expect(tagsOf('<p>see https://a.b/c</p><button type="submit">x</button>', /^button$/)).toHaveLength(1);
    });
    it('CONTROL - a real // comment is still blanked', () => {
        expect(tagsOf('// <button type="submit">x</button>', /^button$/)).toHaveLength(0);
        expect(tagsOf('const a = 1; // <button>\n<button id="q">x</button>', /^button$/)).toHaveLength(1);
    });
    it('a regex literal containing a quote does not open a string', () => {
        const src = 'const re = /["\']/; const b = <button type="submit">x</button>;';
        expect(tagsOf(src, /^button$/)).toHaveLength(1);
        expect(attr(tagsOf(src, /^button$/)[0], 'type')).toBe('"submit"');
    });
    it('recognises a regex after ( , : and return', () => {
        for (const head of ['x.test(/"/)', 'f(a, /\'/)', 'const o = { k: /"/ }', 'return /\'/.test(s)']) {
            expect(tagsOf(`${head}; <button>x</button>`, /^button$/), head).toHaveLength(1);
        }
    });
    it('CONTROL - division and closing tags are not mistaken for a regex', () => {
        const src = 'const h = a / b; const w = c / d;\n<div>x</div><button>y</button>';
        expect(tagsOf(src, /^button$/)).toHaveLength(1);
        const a = analyze('<div>a / b</div>');
        const [div] = findOpeningTags(a, /^div$/);
        expect(elementBody(a, div)).toContain('a / b');
    });
    it('reads a tag with a TSX generic argument list', () => {
        const [t] = tagsOf('<Select<Option> value={v} onChange={f} />', /^Select$/);
        expect(t?.name).toBe('Select');
        expect(attr(t, 'value')).toBe('{v}');
        const [u] = tagsOf('<Table<{ id: string }, "a" | "b"> rows={r}>x</Table>', /^Table$/);
        expect(attr(u, 'rows')).toBe('{r}');
    });
    it('a generic arrow type with => inside the argument list does not end the tag early', () => {
        const [t] = tagsOf('<List<(a: number) => void> items={i} />', /^List$/);
        expect(attr(t, 'items')).toBe('{i}');
    });

    // Bounds that stay: pinned so that a future change to them is a decision, not an accident.
    describe('documented bounds (current behaviour, pinned)', () => {
        it('BOUND - a // inside JSX text that does not follow a URL scheme still blanks the rest of the line', () => {
            expect(tagsOf('<p>a // b</p><button>x</button>', /^button$/)).toHaveLength(0);
        });
        it('BOUND - a double quote in JSX text opens a string that runs to the end of the line', () => {
            expect(tagsOf('<p>say "hi</p><button>x</button>\n', /^button$/)).toHaveLength(0);
        });
        it('BOUND - an apostrophe after a letter is prose, but one after a space opens a string', () => {
            expect(tagsOf("<p>it's</p><button>x</button>", /^button$/)).toHaveLength(1);
            expect(tagsOf("<p>a 'b</p><button>x</button>", /^button$/)).toHaveLength(0);
        });
    });
});
