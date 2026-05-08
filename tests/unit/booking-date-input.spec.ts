/**
 * R7-06 — /book inspection date input is a native date picker.
 *
 * Static check on the JSX template + Alpine handler so the responsive label
 * regression is caught without needing a fully-seeded local Cloudflare dev
 * server. The complementary Playwright spec at
 * `tests/booking-date-input.spec.ts` exercises the live page when the dev
 * server is running; this unit spec is the always-green floor.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const tsxPath = resolve(__dirname, '../../src/templates/pages/booking.tsx');
const jsPath  = resolve(__dirname, '../../public/js/booking.js');
const tsx = readFileSync(tsxPath, 'utf8');
const js  = readFileSync(jsPath,  'utf8');

describe('R7-06 — /book inspection date input', () => {
    it('uses type="date" so mobile Safari shows the native spinner', () => {
        // The previous code used type="text" + a JS mask. The fix flips the
        // input to a native <input type="date"> which triggers the native
        // iOS spinner picker on mobile Safari.
        expect(tsx).toMatch(/type="date"\s+name="inspectionDate"/);
        // And no leftover "type=text" + "name=dateMasked" remnant.
        expect(tsx).not.toMatch(/type="text"\s+name="dateMasked"/);
    });

    it('Alpine handler reads the ISO YYYY-MM-DD value into `inspectionDate`', () => {
        // The handler must declare an `inspectionDate` field initialized to
        // the empty string and a `validateDate()` method that checks for the
        // ISO YYYY-MM-DD shape produced by the native date picker.
        expect(js).toMatch(/inspectionDate:\s*''/);
        expect(js).toMatch(/inspectionDate\.match\(\/\^\(\\d\{4\}\)-\(\\d\{2\}\)-\(\\d\{2\}\)\$\//);
        // `toIsoDate()` should pass the value straight through (it's already
        // in the wire format).
        expect(js).toMatch(/this\.inspectionDate \|\| ''/);
    });

    it('removed the legacy mask state (`dateMasked` / `formatDate`)', () => {
        // Old fields gone — they shouldn't reappear in a future revert.
        expect(js).not.toMatch(/dateMasked:\s*''/);
        expect(js).not.toMatch(/formatDate\(e\)/);
    });
});
