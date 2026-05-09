/**
 * Iter-2 bug #6 — every <input type="date"> in the codebase must carry an
 * explicit `lang="en"` so Chromium-based browsers running with a non-English
 * OS locale don't render the native placeholder as 「年/月/日」 (zh-CN) or
 * its other locale-specific equivalents.
 *
 * Static check on each template that has a date input. Cheap to run and
 * cheap to keep green — also acts as a regression fence so a future PR
 * cannot reintroduce a date input without the attribute.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const TEMPLATES = [
    'src/templates/pages/booking.tsx',
    'src/templates/pages/invoices.tsx',
    'src/templates/pages/inspection/settings.tsx',
];

describe('iter-2 bug #6 — <input type="date"> lang="en"', () => {
    for (const rel of TEMPLATES) {
        it(`${rel} — every type="date" carries lang="en"`, () => {
            const raw = readFileSync(resolve(__dirname, '../../', rel), 'utf8');
            // Strip JS/JSX block + line comments + JSX `{/* … */}` comment
            // blocks — date-input strings appearing in prose docs (e.g. the
            // file-level comment about the locale leak) are not real markup.
            const src = raw
                .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
                .replace(/\/\*[\s\S]*?\*\//g, '')
                .replace(/\/\/.*$/gm, '');
            // Find every occurrence of type="date".
            const matches = [...src.matchAll(/type="date"/g)];
            expect(matches.length, `expected at least one <input type="date"> in ${rel}`).toBeGreaterThan(0);

            // For each occurrence, walk forward from the type="date" attribute
            // to the closing `/>` of the same tag and assert lang="en" appears
            // somewhere inside that span. Walking forward avoids being fooled
            // by sibling <input ...> tags above the date input.
            for (const m of matches) {
                const idx = m.index ?? 0;
                // Look for the tag's lang attribute either before or after the
                // type="date" attribute, but only within the same tag.
                const tagEnd = src.indexOf('/>', idx);
                expect(tagEnd, 'closing /> not found').toBeGreaterThan(idx);
                // Walk back from idx to the most recent '<input' we have not
                // yet closed. We do this by counting `/>` and `<input` tokens.
                let cursor = idx;
                let depth = 0;
                while (cursor > 0) {
                    cursor--;
                    if (src.startsWith('/>', cursor)) depth++;
                    if (src.startsWith('<input', cursor)) {
                        if (depth === 0) break;
                        depth--;
                    }
                }
                const tag = src.slice(cursor, tagEnd + 2);
                expect(tag, `<input type="date"> at offset ${idx} must declare lang="en"`).toMatch(/lang="en"/);
            }
        });
    }
});
