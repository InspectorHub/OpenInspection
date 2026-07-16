/**
 * Unit tests for the calendar timezone-safety gate.
 *
 * Tests the exported `findTzViolations` from `scripts/check-tz-safety.mjs`
 * with string fixtures. The gate keeps the off-by-one bug
 * (docs/superpowers/plans/2026-07-16-oi-calendar-tz-offbyone-apolish-backlog.md)
 * from creeping back into the calendar surface.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

// Load the .mjs via native Node import inside beforeAll (top-level await breaks
// the vitest/esbuild transform; see check-timestamps.spec.ts).
let findTzViolations: (source: string, filename: string) => string[];

beforeAll(async () => {
    const scriptPath = path.resolve(
        import.meta.dirname ?? path.join(process.cwd()),
        '../../../scripts/check-tz-safety.mjs',
    );
    ({ findTzViolations } = await import(/* @vite-ignore */ pathToFileURL(scriptPath).href));
});

describe('check-tz-safety gate', () => {
    it('flags a hardcoded-Z instant composed from a civil date + wall time (P1)', () => {
        expect(findTzViolations('const s = `${dateStr}T09:00:00.000Z`;', 'x.ts')).toHaveLength(1);
        expect(findTzViolations('new Date(`${d}T09:00Z`)', 'x.ts')).toHaveLength(1);
    });

    it('flags a literal ISO-with-Z instant (P1 literal)', () => {
        expect(findTzViolations('const s = "2026-07-17T09:00:00.000Z";', 'x.ts')).toHaveLength(1);
    });

    it('flags UTC-day bucketing via .toISOString().slice(0,10) (P2)', () => {
        expect(findTzViolations('const key = d.toISOString().slice(0, 10);', 'x.ts')).toHaveLength(1);
    });

    it('flags reading local parts off a parsed instant (P3)', () => {
        expect(findTzViolations('const h = new Date(ev.start).getHours();', 'x.ts')).toHaveLength(1);
        expect(findTzViolations('const d = new Date(iso).getDate();', 'x.ts')).toHaveLength(1);
    });

    it('does NOT flag multi-arg numeric Date geometry', () => {
        // days-in-month / first-weekday grid math — local by design, no UTC round-trip.
        expect(findTzViolations('const n = new Date(year, month + 1, 0).getDate();', 'x.ts')).toEqual([]);
        expect(findTzViolations('const wd = new Date(year, month, 1).getDay();', 'x.ts')).toEqual([]);
    });

    it('does NOT flag civil-date string assembly or wall-clock strings', () => {
        expect(findTzViolations('const s = `${year}-${mm}-${dd}`;', 'x.ts')).toEqual([]);
        expect(findTzViolations('handleDayClick(`${dateStr}T09:00`);', 'x.ts')).toEqual([]);
    });

    it('respects a same-line // tz-lint-ok exemption', () => {
        const src = 'startInstant: new Date(`${s}T00:00:00.000Z`), // tz-lint-ok: coarse window';
        expect(findTzViolations(src, 'x.ts')).toEqual([]);
    });

    it('respects a // tz-lint-ok exemption on the immediately preceding line', () => {
        const src = ['// tz-lint-ok: coarse window', 'new Date(`${s}T00:00:00.000Z`)'].join('\n');
        expect(findTzViolations(src, 'x.ts')).toEqual([]);
    });
});
