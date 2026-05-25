/**
 * Competitor parity Feature C3 — InlineTextPopover instruction templates.
 *
 * Verifies the global rewrite popover renders a templates row that lets
 * the inspector pick a quick-pick instruction (e.g. "shorten",
 * "less alarming") without typing.
 */

import { describe, it, expect } from 'vitest';
import { InlineTextPopover } from '../../src/templates/components/inline-text-popover';

function render(node: unknown): string {
    return String(node);
}

describe('InlineTextPopover — competitor C3 templates', () => {
    const html = render(InlineTextPopover());

    it('renders the templates row with x-show binding to templates.length', () => {
        expect(html).toContain('data-test="oi-prompt-templates"');
        // hono/jsx HTML-escapes > inside attribute values.
        expect(html).toMatch(/x-show="templates\.length\s*&gt;\s*0"/);
    });

    it('binds template chips via x-for over templates array', () => {
        // Loose check — the JSX template loop is preserved as <template x-for>.
        expect(html).toMatch(/x-for="t in templates"/);
        expect(html).toContain('pickTemplate(t)');
    });

    it('keeps the textarea apply / cancel surface', () => {
        expect(html).toContain('Apply');
        expect(html).toContain('Cancel');
    });

    it('preserves Cmd/Ctrl+Enter shortcut on the textarea', () => {
        expect(html).toContain('x-on:keydown.cmd.enter.prevent="apply()"');
        expect(html).toContain('x-on:keydown.ctrl.enter.prevent="apply()"');
    });
});
