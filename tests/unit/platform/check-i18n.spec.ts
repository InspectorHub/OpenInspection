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

    it('does NOT flag a bare (locale-less) toLocale call', () => {
        // Browser-default locale — already viewer-responsive; not this gate's target.
        expect(findI18nViolations('d.toLocaleDateString()', 'x.ts')).toEqual([]);
        expect(findI18nViolations('d.toLocaleString(undefined, { month: "short" })', 'x.ts')).toEqual([]);
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
