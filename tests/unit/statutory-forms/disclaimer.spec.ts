/**
 * The notice that travels with a rendered statutory form.
 *
 * It is an ALLOCATION statement, not a liability waiver, and the difference is
 * the closing sentence. Without it the notice drifts into "if we drew it wrong,
 * that is your problem", which is an ineffective risk-shift: it does not move
 * the risk, it only reads as though it did.
 *
 * WARNING ON APOSTROPHES. Every apostrophe in the notice and in this file is
 * U+2019 (a typographic apostrophe), never U+0027. They render almost
 * identically, so a mismatch fails `toContain` for a reason nobody can see --
 * and the next person fixes the TEST rather than the text.
 */
import { describe, it, expect } from 'vitest';
import {
    STATUTORY_FORM_NOTICE,
    statutoryNoticeFor,
    formatEffectiveDate,
} from '../../../server/lib/statutory/disclaimer';
import type { StatutoryFormVersion } from '../../../server/lib/statutory/form-registry';

/** U+2019 in "inspector’s". Compare byte for byte with the module. */
const LOAD_BEARING =
    'that difference is not made the inspector’s responsibility merely by this notice';

const VERSION: StatutoryFormVersion = {
    formId: 'yy_flat_form', version: 'Rev. 04/26',
    effectiveFrom: Date.UTC(2026, 3, 1),
    mandatoryFrom: Date.UTC(2026, 3, 1),
    effectiveUntil: null,
    sourceUrl: 'https://example.gov/f.pdf', sourceHash: 'a'.repeat(64),
    publishedBy: 'a.operator', publishedAt: Date.UTC(2026, 3, 1),
};

describe('the statutory form notice', () => {
    it('the closing sentence is present, verbatim', () => {
        // It exists to stop the notice becoming an ineffective risk-shift. A
        // copy-simplification pass that drops it changes what the notice IS.
        expect(STATUTORY_FORM_NOTICE).toContain(LOAD_BEARING);
    });

    it('names the form, its revision and its effective date from the version row', () => {
        const text = statutoryNoticeFor(VERSION, { softwareName: 'Acme Inspect' });
        expect(text).toContain(VERSION.version);
        expect(text).toContain(formatEffectiveDate(VERSION.effectiveFrom));
        expect(text).toContain(VERSION.formId);
    });

    it('keeps the closing sentence after interpolation', () => {
        // The substring above is checked on the TEMPLATE; this checks it
        // survives being rendered, which is the form anybody actually reads.
        expect(statutoryNoticeFor(VERSION, { softwareName: 'Acme Inspect' })).toContain(LOAD_BEARING);
    });

    it('never claims the form is approved or endorsed by the issuing authority', () => {
        expect(STATUTORY_FORM_NOTICE).not.toMatch(/\b(approved|endorsed|certified)\s+by\b/i);
        expect(statutoryNoticeFor(VERSION, { softwareName: 'Acme Inspect' }))
            .not.toMatch(/\b(approved|endorsed|certified)\s+by\b/i);
    });

    it('leaves no placeholder unfilled', () => {
        // A placeholder that reaches a reader is worse than a missing notice:
        // it looks like a bug in the document the authority published.
        expect(statutoryNoticeFor(VERSION, { softwareName: 'Acme Inspect' })).not.toMatch(/\{[a-z]+\}/);
    });

    it('states the effective date in UTC, matching how the revision was chosen', () => {
        // The selector reads UTC midnight. A notice formatted in local time
        // could print the day before the one that actually governs.
        expect(formatEffectiveDate(Date.UTC(2026, 3, 1))).toBe('2026-04-01');
    });

    it('POSITIVE CONTROL — the notice actually says who is responsible', () => {
        // Without this, a notice reduced to only its closing sentence would
        // pass every assertion above while allocating nothing.
        expect(STATUTORY_FORM_NOTICE).toContain('The inspector is responsible');
    });
});
