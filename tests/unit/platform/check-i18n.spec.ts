/**
 * Unit tests for the i18n formatting gate.
 *
 * Tests the exported `findI18nViolations` from `scripts/check-i18n.mjs` with
 * string fixtures. The gate stops new hardcoded-`en-US` formatting from creeping
 * back in after the Phase A migration to the shared locale-aware formatter.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

let findI18nViolations: (source: string, filename: string) => string[];

beforeAll(async () => {
    const scriptPath = path.resolve(
        import.meta.dirname ?? path.join(process.cwd()),
        '../../../scripts/check-i18n.mjs',
    );
    ({ findI18nViolations } = await import(/* @vite-ignore */ pathToFileURL(scriptPath).href));
});

describe('check-i18n gate', () => {
    it('flags hardcoded en-US in toLocale*String', () => {
        expect(findI18nViolations("d.toLocaleDateString('en-US', { month: 'short' })", 'x.ts')).toHaveLength(1);
        expect(findI18nViolations('d.toLocaleTimeString("en-US")', 'x.ts')).toHaveLength(1);
        expect(findI18nViolations("n.toLocaleString('en-US', { style: 'currency' })", 'x.ts')).toHaveLength(1);
    });

    it('flags hardcoded en-US in Intl formatters', () => {
        expect(findI18nViolations("new Intl.DateTimeFormat('en-US', { timeZone: tz })", 'x.ts')).toHaveLength(1);
        expect(findI18nViolations("new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })", 'x.ts')).toHaveLength(1);
    });

    it('does NOT flag the shared formatter usage (locale is a variable)', () => {
        expect(findI18nViolations('new Intl.DateTimeFormat(opts.locale, { month: "short" })', 'x.ts')).toEqual([]);
        expect(findI18nViolations('formatDate(x, { locale, timeZone: tz, month: "short" })', 'x.ts')).toEqual([]);
    });

    // #270 — this used to assert the OPPOSITE, on the reasoning that a bare call
    // is "already viewer-responsive". It is not: it reads navigator.language and
    // the browser's timezone, which are nobody's configured preference, so the
    // date disagrees with every other date on the page.
    it('flags a locale-less date format', () => {
        expect(findI18nViolations('d.toLocaleDateString()', 'x.ts')).toHaveLength(1);
        expect(findI18nViolations('d.toLocaleTimeString(undefined, { hour: "numeric" })', 'x.ts')).toHaveLength(1);
        expect(findI18nViolations('new Date(epochMs).toLocaleString()', 'x.ts')).toHaveLength(1);
        expect(findI18nViolations('{new Date(e.ts).toLocaleString(undefined)}', 'x.ts')).toHaveLength(1);
    });

    it('does NOT flag number formatting via toLocaleString', () => {
        // `.toLocaleString()` on a Number is currency/number formatting — a
        // different concern, and the reason the Date rule anchors on `new Date(`.
        expect(findI18nViolations('`$${(min / 100).toLocaleString()}`', 'x.ts')).toEqual([]);
        expect(findI18nViolations('defect.estimateHigh.toLocaleString()', 'x.ts')).toEqual([]);
    });

    it('does NOT flag prose that merely describes the bad pattern', () => {
        // Comment lines are skipped; several files explain the defect in words.
        expect(findI18nViolations(' * `toLocaleDateString(undefined, …)` reads navigator.language', 'x.ts')).toEqual([]);
        expect(findI18nViolations('// never toLocaleDateString() here', 'x.ts')).toEqual([]);
    });

    it('does NOT flag a date format that names its locale', () => {
        expect(findI18nViolations('d.toLocaleDateString(locale, { weekday: "short" })', 'x.ts')).toEqual([]);
        expect(findI18nViolations('formatDate(iso, { locale })', 'x.ts')).toEqual([]);
    });

    it('respects a same-line // i18n-lint-ok exemption', () => {
        const src = "new Intl.DateTimeFormat('en-US', { timeZone: tz }); // i18n-lint-ok: offset math";
        expect(findI18nViolations(src, 'x.ts')).toEqual([]);
    });

    it('respects a // i18n-lint-ok exemption on the preceding line', () => {
        const src = ['// i18n-lint-ok: offset math', "new Intl.DateTimeFormat('en-US', { timeZone: tz })"].join('\n');
        expect(findI18nViolations(src, 'x.ts')).toEqual([]);
    });
});
