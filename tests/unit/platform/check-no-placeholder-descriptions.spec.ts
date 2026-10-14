/**
 * Unit tests for the placeholder-description ratchet.
 *
 * Exercises the exported pure functions of
 * `scripts/check-no-placeholder-descriptions.mjs` with in-memory fixtures.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

type Cat = 'source' | 'snapshot' | 'contract';
interface Tally { by: Record<Cat, { hits: number; files: number }>; hits: number; scanned: number }
let countPlaceholders: (text: string) => number;
let tally: (files: { category: Cat; path: string; text: string }[]) => Tally;
let evaluate: (r: Tally, b: Record<string, number>) => { errors: string[]; tighten: string[] };

beforeAll(async () => {
    const scriptPath = path.resolve(
        import.meta.dirname ?? process.cwd(),
        '../../../scripts/check-no-placeholder-descriptions.mjs',
    );
    // @vite-ignore - load the .mjs natively, as the sibling gate specs do.
    ({ countPlaceholders, tally, evaluate } = await import(/* @vite-ignore */ pathToFileURL(scriptPath).href));
});

const ZERO = { source: 0, snapshot: 0, contract: 0 };
const clean = [
    { category: 'source' as const, path: 'server/a.ts', text: "description: 'Lists inspections.'" },
    { category: 'snapshot' as const, path: 'snap.json', text: '{"description":"Real text"}' },
    { category: 'contract' as const, path: 'contracts/c.json', text: '{}' },
];

describe('check-no-placeholder-descriptions gate', () => {
    it('counts both literal placeholder phrases', () => {
        expect(countPlaceholders('Auto-generated placeholder x TODO describe y Auto-generated placeholder')).toBe(3);
        expect(countPlaceholders('A real description')).toBe(0);
    });

    it('is red when a placeholder appears above the baseline', () => {
        const files = [...clean, { category: 'source' as const, path: 'server/b.ts', text: "description: 'Auto-generated placeholder'" }];
        const { errors } = evaluate(tally(files), ZERO);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain('source');
    });

    it('is green on clean input at a zero baseline', () => {
        const { errors, tighten } = evaluate(tally(clean), ZERO);
        expect(errors).toEqual([]);
        expect(tighten).toEqual([]);
    });

    it('asks to tighten when below baseline, without failing', () => {
        const { errors, tighten } = evaluate(tally(clean), { ...ZERO, source: 4 });
        expect(errors).toEqual([]);
        expect(tighten).toHaveLength(1);
    });

    it('fails when zero files were scanned', () => {
        const { errors } = evaluate(tally([]), ZERO);
        expect(errors.some((e) => e.includes('scanned 0 files'))).toBe(true);
    });
});
