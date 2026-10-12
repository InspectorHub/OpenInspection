import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain .mjs helper, no types alongside it (same as the other tooling specs).
import { analyze, elementBody, findOpeningTags } from '../../../scripts/lib/jsx-scan.mjs';

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
