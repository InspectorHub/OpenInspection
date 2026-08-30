/**
 * The server's refusal when a revision has been withdrawn — one sentence per
 * reason, and never one sentence for both.
 *
 * "This revision was withdrawn" is the sentence that fails: true of both causes
 * and actionable for neither. Our own field map being wrong means a correction
 * is coming from us and the documents already issued should be issued again
 * once it lands; an authority's withdrawal means no correction is ever coming
 * and the reader has to go and get the form now required. Told only that a
 * revision was withdrawn, half of them wait for a fix that will never arrive.
 *
 * Every assertion below is a RELATION between the two messages or between a
 * message and its input, not a comparison with a sentence typed in this file —
 * copy gets edited, and a test that pinned the wording would have to be edited
 * with it, which is the test agreeing with whatever was written last.
 */
import { describe, it, expect } from 'vitest';
import { withdrawalRefusal } from '../../../server/lib/statutory/withdrawal-copy';

const base = {
    formId: 'yy_flat_form',
    version: 'Rev. 01/25',
    at: Date.UTC(2026, 3, 1),
    replacementVersion: 'Rev. 04/26',
    inspectionDate: '2026-05-01',
};

describe('withdrawalRefusal', () => {
    it('says a different thing for each reason', () => {
        const ours = withdrawalRefusal({ ...base, reason: 'field_map_incorrect' });
        const theirs = withdrawalRefusal({ ...base, reason: 'authority_withdrew' });
        expect(ours).not.toBe(theirs);
    });

    it('states the facts in both, so the difference is not one saying less', () => {
        for (const reason of (['field_map_incorrect', 'authority_withdrew'] as const)) {
            const message = withdrawalRefusal({ ...base, reason });
            expect(message).toContain(base.version);
            expect(message).toContain(base.replacementVersion);
            // The withdrawal date, spelled the way the revision was selected:
            // UTC, matching inspection-date.ts. A locale-formatted date here
            // would name a different day than the one it took effect on.
            expect(message).toContain('2026-04-01');
        }
    });

    it('promises a correction for our fault, and refuses to for theirs', () => {
        // The one distinguishing instruction. Getting this backwards is the
        // failure this whole state exists to prevent.
        const ours = withdrawalRefusal({ ...base, reason: 'field_map_incorrect' });
        const theirs = withdrawalRefusal({ ...base, reason: 'authority_withdrew' });
        expect(ours).toMatch(/corrected map is published as a software update/i);
        expect(ours).toMatch(/produced again/i);
        expect(theirs).toMatch(/not a defect a software update will correct/i);
        expect(theirs).toMatch(/not reissued/i);
    });

    it('does not name a replacement that does not exist', () => {
        // An authority may withdraw a revision before publishing its successor.
        // Naming one then sends somebody looking for a form nobody has.
        const message = withdrawalRefusal({
            ...base, reason: 'authority_withdrew', replacementVersion: null,
        });
        expect(message).not.toContain('Rev. 04/26');
        // The positive control against a message that simply says less: it still
        // names the withdrawn revision and the date it could not cover.
        expect(message).toContain(base.version);
        expect(message).toContain(base.inspectionDate);
    });

    it('is English, with no message-catalogue placeholder left in it', () => {
        // This path has no request locale in scope and loads no catalogue, so a
        // `{version}` surviving into the output would ship to an operator as-is.
        for (const reason of (['field_map_incorrect', 'authority_withdrew'] as const)) {
            expect(withdrawalRefusal({ ...base, reason })).not.toMatch(/\{[a-zA-Z]+\}/);
        }
    });
});
