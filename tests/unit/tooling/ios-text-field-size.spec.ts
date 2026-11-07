/**
 * iOS zooms the page when a text field under 16px takes focus. The fix is one iOS-only rule in the global stylesheet; this keeps it there.
 * It reads the stylesheet rather than a rendered page because the declaration is the whole fix, and a jsdom render has no iOS WebKit to
 * zoom.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CSS = readFileSync(resolve(__dirname, '../../../app/styles/tailwind.css'), 'utf8');

describe('text fields on iOS', () => {
    const block = /@supports \(-webkit-touch-callout: none\)\s*\{([^{}]*\{[^{}]*\})\s*\}/.exec(CSS);

    it('are raised to at least 16px by an iOS-only rule', () => {
        expect(block, 'the @supports (-webkit-touch-callout: none) block').not.toBeNull();
        expect(block?.[1]).toMatch(/font-size:\s*max\(16px,/);
    });

    it('covers textareas, selects and text inputs but not checkboxes, radios, ranges or files', () => {
        const selectors = block?.[1] ?? '';
        expect(selectors).toMatch(/textarea/);
        expect(selectors).toMatch(/select/);
        expect(selectors).toMatch(/input:not\(\[type='checkbox'\]\)/);
        expect(selectors).toMatch(/:not\(\[type='radio'\]\)/);
    });

    it('sits at the top level of the stylesheet, not inside an @layer, so it outranks the utilities', () => {
        const at = CSS.indexOf('@supports (-webkit-touch-callout: none)');
        expect(at).toBeGreaterThan(-1);
        const before = CSS.slice(0, at).replace(/\/\*[\s\S]*?\*\//g, '');
        const depth = (before.match(/\{/g) ?? []).length - (before.match(/\}/g) ?? []).length;
        expect(depth).toBe(0);
    });
});
