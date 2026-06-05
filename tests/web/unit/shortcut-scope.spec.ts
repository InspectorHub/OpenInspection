import { describe, it, expect } from 'vitest';
import { singleKeyShortcutsAllowed } from '~/lib/shortcut-scope';

describe('singleKeyShortcutsAllowed', () => {
    it('allows when focus is on body', () => {
        expect(singleKeyShortcutsAllowed(document.body, false)).toBe(true);
    });
    it('blocks during IME composition', () => {
        expect(singleKeyShortcutsAllowed(document.body, true)).toBe(false);
    });
    it('blocks inside inputs/textareas/selects/contentEditable', () => {
        for (const tag of ['input', 'textarea', 'select'] as const) {
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
});
