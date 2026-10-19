/**
 * A page size the list routes refuse is a 400, and the loaders that read a list
 * best-effort turn a 400 into "empty". The checklist's template count was always
 * zero for exactly that reason. The shared pagination schema accepts only the
 * sizes in PAGE_SIZES, so every literal page size the app sends must be one.
 *
 * This reads the app sources, so it also covers a call nobody wrote a test for.
 * It is deliberately narrow: it checks the literal `pageSize` values (quoted
 * numbers and the named constant the dashboard uses), not every query key.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PAGE_SIZES } from '../../../server/lib/validations/pagination.schema';
import { SMALLEST_PAGE_SIZE } from '../../../app/lib/dashboard-setup.server';

const APP = join(__dirname, '../../../app');

function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        if (name === 'paraglide') continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
    }
    return out;
}

describe('literal page sizes sent by the app', () => {
    const literal = /pageSize:\s*["'](\d+)["']/g;
    const found: Array<{ file: string; value: number }> = [];
    for (const file of walk(APP)) {
        const text = readFileSync(file, 'utf8');
        for (const m of text.matchAll(literal)) found.push({ file: file.slice(APP.length + 1), value: Number(m[1]) });
    }

    it('finds the literals it is meant to guard (the instrument is alive)', () => {
        expect(found.length).toBeGreaterThan(3);
    });

    it('every literal is a size the shared pagination schema accepts', () => {
        const bad = found.filter((f) => !(PAGE_SIZES as readonly number[]).includes(f.value));
        expect(bad).toEqual([]);
    });

    it('the dashboard checklist uses an accepted size', () => {
        expect((PAGE_SIZES as readonly number[]).includes(Number(SMALLEST_PAGE_SIZE))).toBe(true);
        expect(Number(SMALLEST_PAGE_SIZE)).toBe(Math.min(...PAGE_SIZES));
    });
});
