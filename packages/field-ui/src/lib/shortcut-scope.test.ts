// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { singleKeyShortcutsAllowed } from './shortcut-scope';

describe('singleKeyShortcutsAllowed', () => {
    it('allows when focus is on body', () => {
        expect(singleKeyShortcutsAllowed(document.body, false)).toBe(true);
    });
    it('blocks during IME composition', () => {
        expect(singleKeyShortcutsAllowed(document.body, true)).toBe(false);
    });
    it('blocks inside inputs/textareas/selects/contentEditable', () => {
        // Deliberately NOT `as const`: the literal-tag overload of
        // `createElement` returns `HTMLSelectElement` for 'select', and in this
        // program that type is not assignable to `Element` (see
        // tests/helpers/dom.ts for why). The generic overload returns
        // `HTMLElement`, which is all this loop needs.
        for (const tag of ['input', 'textarea', 'select']) {
            const el = document.createElement(tag);
            document.body.appendChild(el);
            expect(singleKeyShortcutsAllowed(el, false)).toBe(false);
        }
        const ce = document.createElement('div');
        Object.defineProperty(ce, 'isContentEditable', { value: true });
        expect(singleKeyShortcutsAllowed(ce, false)).toBe(false);
    });
    it('blocks on random focusable elements OUTSIDE an opted-in scope', () => {
        const btn = document.createElement('button');
        document.body.appendChild(btn);
        expect(singleKeyShortcutsAllowed(btn, false)).toBe(false);
    });
    it('allows on elements INSIDE a data-shortcut-scope container', () => {
        const scope = document.createElement('div');
        scope.setAttribute('data-shortcut-scope', '');
        const btn = document.createElement('button');
        scope.appendChild(btn);
        document.body.appendChild(scope);
        expect(singleKeyShortcutsAllowed(btn, false)).toBe(true);
    });
    it('allows when focus sits on <main> itself: where a closing drawer or dialog puts focus back', () => {
        // On the phone and tablet layouts a bottom drawer closes onto <main>, and without this the number keys,
        // J/K and the other single-key shortcuts stay dead for a hardware keyboard until something else is focused.
        const main = document.createElement('main');
        document.body.appendChild(main);
        expect(singleKeyShortcutsAllowed(main, false)).toBe(true);
    });
    it('still blocks a control INSIDE <main>: only main itself is the focus fallback', () => {
        const main = document.createElement('main');
        const btn = document.createElement('button');
        main.appendChild(btn);
        document.body.appendChild(main);
        expect(singleKeyShortcutsAllowed(btn, false)).toBe(false);
    });
});
