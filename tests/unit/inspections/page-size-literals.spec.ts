/**
 * A page size the list routes refuse is a 400, and the loaders that read a list
 * best-effort turn a 400 into "empty". The checklist's template count was always
 * zero for exactly that reason. The shared pagination schema accepts only the
 * sizes in PAGE_SIZES, so every literal page size the app sends must be one.
 *
 * The finder recognises a size written as a quoted number, a bare number,
 * String(n), a template literal without substitutions, `pageSize=n` inside a
 * URL string, and `.set("pageSize", n)`. It reads the app sources, so it also
 * covers a call nobody wrote a test for. It does not follow a size through a
 * variable: that shape is guarded where it is built, and the next case says so.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PAGE_SIZES } from '../../../server/lib/validations/pagination.schema';

const APP = join(__dirname, '../../../app');

/** Every literal page size written in `text`. */
export function findPageSizeLiterals(text: string): number[] {
    const patterns = [
        /pageSize\s*:\s*["'`](\d+)["'`]/g,                          // pageSize: "25", '25', `25`
        /pageSize\s*:\s*(\d+)\b/g,                                      // pageSize: 25
        /pageSize\s*:\s*String\(\s*(\d+)\s*\)/g,                        // pageSize: String(25)
        /pageSize=(\d+)\b/g,                                            // "...?pageSize=25", `...&pageSize=25`
        /\.set\(\s*["'`]pageSize["'`]\s*,\s*(?:String\(\s*)?["'`]?(\d+)["'`]?\s*\)?\s*\)/g, // .set("pageSize", "25" | 25 | String(25))
    ];
    const out: number[] = [];
    for (const re of patterns) for (const m of text.matchAll(re)) out.push(Number(m[1]));
    return out;
}

function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        if (name === 'paraglide') continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
    }
    return out;
}

const accepted = (n: number) => (PAGE_SIZES as readonly number[]).includes(n);

describe('the finder', () => {
    it('sees every way of writing a size (so the check below can fail)', () => {
        const sample = [
            'query: { page: "1", pageSize: "1" }',
            "query: { pageSize: '7' }",
            'query: { pageSize: `9` }',
            'const a = { pageSize: 13 }',
            'query: { pageSize: String(14) }',
            'fetch(`/api/x?page=1&pageSize=15`)',
            'sp.set("pageSize", "16")',
            'sp.set("pageSize", String(17))',
            "sp.set('pageSize', 18)",
        ].join('\n');
        expect(findPageSizeLiterals(sample).sort((a, b) => a - b)).toEqual([1, 7, 9, 13, 14, 15, 16, 17, 18]);
    });

    it('a bad literal in any spelling is rejected, and a good one is not', () => {
        for (const bad of ['pageSize: "1"', 'pageSize: 1', 'pageSize: String(3)', '?pageSize=10', 'sp.set("pageSize", "30")']) {
            expect(findPageSizeLiterals(bad).filter((n) => !accepted(n)), bad).not.toEqual([]);
        }
        for (const good of ['pageSize: "12"', 'pageSize: 100', 'pageSize: String(25)', '?pageSize=50', 'sp.set("pageSize", "12")']) {
            expect(findPageSizeLiterals(good).filter((n) => !accepted(n)), good).toEqual([]);
        }
    });

    it('does not mistake a type annotation or a variable for a literal', () => {
        expect(findPageSizeLiterals('pageSize: number;\nconst x = { pageSize }\n{ pageSize: meta.pageSize }')).toEqual([]);
    });
});

describe('literal page sizes sent by the app', () => {
    const found: Array<{ file: string; value: number }> = [];
    for (const file of walk(APP)) {
        for (const value of findPageSizeLiterals(readFileSync(file, 'utf8'))) found.push({ file: file.slice(APP.length + 1), value });
    }

    it('finds the sizes the app sends today (the scan reads real sources)', () => {
        // The templates pickers send 100 and the template search sends 25; if both vanish the scan has stopped reading.
        expect(found.some((f) => f.value === 100)).toBe(true);
        expect(found.some((f) => f.value === 25)).toBe(true);
    });

    it('every literal is a size the shared pagination schema accepts', () => {
        expect(found.filter((f) => !accepted(f.value))).toEqual([]);
    });
});
