import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain .mjs helper, no types alongside it (same as the other tooling specs).
import { detectHiddenFocusable } from '../../../scripts/lib/hidden-focusable-detect.mjs';

interface Hit { line: number; rule: string }
const run = (src: string) => detectHiddenFocusable(src) as { sites: number; violations: Hit[] };
const rules = (src: string) => run(src).violations.map((v) => v.rule);

/** Each violation is paired with a clean control so neither "flags nothing" nor "flags all" can pass. */
describe('hidden-focusable detector', () => {
    describe('hover-only reveal', () => {
        it('flags opacity-0 + group-hover:opacity-100 with no focus variant', () => {
            expect(rules('<div className="opacity-0 group-hover:opacity-100">hi</div>')).toEqual(['hover-only-reveal']);
        });
        it('flags opacity-0 + hover:opacity-100 and a named group', () => {
            expect(rules('<span className="opacity-0 hover:opacity-100">x</span>')).toEqual(['hover-only-reveal']);
            expect(rules('<span className="opacity-0 group-hover/row:opacity-100">x</span>')).toEqual(['hover-only-reveal']);
        });
        it.each([
            'focus-within:opacity-100',
            'focus-visible:opacity-100',
            'focus:opacity-100',
            'group-focus-within:opacity-100',
        ])('does not flag the reveal when %s is present', (v) => {
            expect(rules(`<span className="opacity-0 group-hover:opacity-100 ${v}">x</span>`)).toEqual([]);
        });
        it('finds the class in a cn() call and a template with a conditional', () => {
            expect(rules('<div className={cn("opacity-0", "group-hover:opacity-100")}>x</div>')).toEqual(['hover-only-reveal']);
            expect(rules('<div className={`a ${on ? "opacity-0 hover:opacity-100" : ""}`}>x</div>')).toEqual(['hover-only-reveal']);
        });
        it('does not flag opacity-0 without a hover reveal, nor a hover reveal without opacity-0', () => {
            expect(rules('<div className="opacity-0 transition-opacity">x</div>')).toEqual([]);
            expect(rules('<div className="opacity-60 hover:opacity-100">x</div>')).toEqual([]);
        });
    });

    describe('touch variant', () => {
        const base = 'opacity-0 group-hover:opacity-100 focus-within:opacity-100';
        it('flags a button missing the hover:none variant', () => {
            expect(rules(`<button className="${base}">x</button>`)).toEqual(['hover-only-touch']);
        });
        it('flags a wrapper that contains a button or link', () => {
            expect(rules(`<div className="${base}"><button>x</button></div>`)).toEqual(['hover-only-touch']);
            expect(rules(`<div className="${base}"><Link to="/a">x</Link></div>`)).toEqual(['hover-only-touch']);
        });
        it('does not flag a purely decorative element with no control inside', () => {
            expect(rules(`<span className="${base}">label</span>`)).toEqual([]);
        });
        it('does not flag a button that has the hover:none variant', () => {
            expect(rules(`<button className="${base} [@media(hover:none)]:opacity-100">x</button>`)).toEqual([]);
        });
        it('reports both rules for a control with neither variant', () => {
            expect(rules('<button className="opacity-0 group-hover:opacity-100">x</button>').sort())
                .toEqual(['hover-only-reveal', 'hover-only-touch']);
        });
        it('does not take a control from a sibling element as contained', () => {
            expect(rules(`<div><span className="${base}">a</span><button>b</button></div>`)).toEqual([]);
        });
    });

    describe('parked panels', () => {
        it('flags a conditional translate-y-full with no inert', () => {
            expect(rules('<div className={`fixed ${open ? "translate-y-0" : "translate-y-full"}`}>x</div>')).toEqual(['parked-not-inert']);
        });
        it('flags -translate-x-full and translate-x-full', () => {
            expect(rules('<aside className={open ? "translate-x-0" : "-translate-x-full"}>x</aside>')).toEqual(['parked-not-inert']);
            expect(rules('<aside className="translate-x-full">x</aside>')).toEqual(['parked-not-inert']);
        });
        it('does not flag the same panel when inert is set on that element', () => {
            expect(rules('<div inert={!open} className={open ? "translate-y-0" : "translate-y-full"}>x</div>')).toEqual([]);
            expect(rules('<div inert className="translate-y-full">x</div>')).toEqual([]);
        });
        it('does not accept inert that sits on a DIFFERENT element', () => {
            expect(rules('<div inert={!open}><div className="translate-y-full">x</div></div>')).toEqual(['parked-not-inert']);
        });
        it('does not flag partial translates', () => {
            expect(rules('<div className="translate-y-1/2 -translate-x-1/2">x</div>')).toEqual([]);
        });
    });

    describe('what is not an element', () => {
        it('ignores comments and plain strings', () => {
            expect(rules('// <div className="opacity-0 group-hover:opacity-100">\nconst s = \'<div className="translate-y-full">\';')).toEqual([]);
        });
    });

    describe('exception marker', () => {
        it('honours a marker with a reason', () => {
            expect(rules('{/* hidden-focusable-allow: decorative, aria-hidden */}\n<div className="opacity-0 hover:opacity-100">x</div>')).toEqual([]);
        });
        it('ignores a marker with no reason', () => {
            expect(rules('// hidden-focusable-allow:\n<div className="translate-y-full">x</div>')).toEqual(['parked-not-inert']);
        });
    });

    it('counts clean candidate sites so an empty result is not read as green', () => {
        const r = run('<div inert className="translate-y-full">x</div><span className="opacity-0 hover:opacity-100 focus:opacity-100">y</span>');
        expect(r.sites).toBe(2);
        expect(r.violations).toEqual([]);
    });
});
