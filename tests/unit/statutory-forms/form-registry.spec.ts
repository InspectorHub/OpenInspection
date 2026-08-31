/**
 * Which revision of a statutory form applies is decided by the INSPECTION DATE.
 *
 * Not by which revision is current. A form is often produced weeks after the
 * inspection it describes, and an authority may keep a superseded revision
 * valid for years after publishing its replacement, so "the latest one" is the
 * wrong answer often enough to be a correctness problem rather than an edge
 * case. Rendering this year's revision for last year's inspection produces a
 * different document from the one that inspection was performed against.
 *
 * The fixtures below are shaped like the two real cases the design was measured
 * against, but the dates are the fixture's own: a clean cutover (one revision
 * ends the day the next begins) and a voluntary-use window (a revision is
 * publishable months before it is mandatory, and both are usable meanwhile).
 */
import { describe, it, expect } from 'vitest';
import {
    versionForInspection,
    selectableVersions,
    type StatutoryFormVersion,
} from '../../../server/lib/statutory/form-registry';

/** A UTC midnight epoch-ms for a civil date, so no fixture depends on the host zone. */
const t = (isoDate: string): number => Date.parse(`${isoDate}T00:00:00.000Z`);

const base = {
    sourceUrl: 'https://example.gov/forms/example.pdf',
    sourceHash: '0'.repeat(64),
    publishedBy: 'platform',
    publishedAt: t('2026-08-21'),
    withdrawn: null,
};

/** A clean cutover: the old revision stops being usable the day the new one starts. */
const OLD: StatutoryFormVersion = {
    ...base,
    formId: 'fl_oir_b1_1802',
    formTitle: 'Yankee Flat Form',
    version: 'Rev. 01/12',
    effectiveFrom: t('2012-01-01'),
    mandatoryFrom: t('2012-01-01'),
    effectiveUntil: t('2026-04-01'),
};
const NEW: StatutoryFormVersion = {
    ...base,
    formId: 'fl_oir_b1_1802',
    formTitle: 'Yankee Flat Form',
    version: 'Rev. 04/26',
    effectiveFrom: t('2026-04-01'),
    mandatoryFrom: t('2026-04-01'),
    effectiveUntil: null,
};

/**
 * A voluntary-use window: `7-6` is publishable from 2021-09-01 but not mandatory
 * until 2022-02-01, and `7-5` stays usable until that date. Both revisions are
 * of the SAME form, which is why the form id carries no revision number: the
 * selector below GROUPS on `formId`, so a revision spelt into the id would make
 * these two rows two different forms and this window unexpressible.
 */
const TX_OLD: StatutoryFormVersion = {
    ...base,
    formId: 'tx_trec_rei',
    formTitle: 'Yankee Flat Form',
    version: '7-5',
    effectiveFrom: t('2015-02-01'),
    mandatoryFrom: t('2015-02-01'),
    effectiveUntil: t('2022-02-01'),
};
const TX_NEW: StatutoryFormVersion = {
    ...base,
    formId: 'tx_trec_rei',
    formTitle: 'Yankee Flat Form',
    version: '7-6',
    effectiveFrom: t('2021-09-01'),
    mandatoryFrom: t('2022-02-01'),
    effectiveUntil: null,
};
const TX_VERSIONS = [TX_OLD, TX_NEW];

describe('versionForInspection', () => {
    it('an inspection the day before the change takes the OLD revision', () => {
        expect(versionForInspection('fl_oir_b1_1802', t('2026-03-31'), [OLD, NEW])?.version)
            .toBe('Rev. 01/12');
    });

    it('POSITIVE CONTROL — an inspection on the day takes the NEW one', () => {
        // Without this, the assertion above passes for a function that always
        // returns the oldest version.
        expect(versionForInspection('fl_oir_b1_1802', t('2026-04-01'), [OLD, NEW])?.version)
            .toBe('Rev. 04/26');
    });

    it('never chooses by "current" — a superseded revision is still selectable', () => {
        const chosen = versionForInspection('fl_oir_b1_1802', t('2020-06-01'), [OLD, NEW]);
        expect(chosen?.version).toBe('Rev. 01/12');
        expect(chosen?.effectiveUntil).not.toBeNull();
    });

    it('returns null rather than guessing for a date before any revision', () => {
        expect(versionForInspection('fl_oir_b1_1802', t('2000-01-01'), [OLD, NEW])).toBeNull();
    });

    it('returns null for a form id nothing has published', () => {
        // A form we do not carry must read as "we have no form", never as the
        // nearest one by date — the failure mode is rendering another state's
        // document.
        expect(versionForInspection('ca_unknown_form', t('2026-04-01'), [OLD, NEW])).toBeNull();
    });

    it('ignores revisions of OTHER forms entirely', () => {
        expect(versionForInspection('fl_oir_b1_1802', t('2026-04-01'), [OLD, NEW, TX_NEW])?.version)
            .toBe('Rev. 04/26');
    });

    it('honours a voluntary-use window: the default stays the MANDATORY revision', () => {
        // Inside the window both are usable. The default must not drift to the
        // newer one on its own: using a not-yet-mandatory revision is the
        // inspector's decision, and a registry that made it for them would be
        // silently substituting one statutory document for another.
        const chosen = versionForInspection('tx_trec_rei', t('2021-11-01'), TX_VERSIONS);
        expect(chosen?.version).toBe('7-5');
    });

    it('POSITIVE CONTROL — after the mandatory date the default is the NEW revision', () => {
        expect(versionForInspection('tx_trec_rei', t('2022-03-01'), TX_VERSIONS)?.version)
            .toBe('7-6');
    });

    it('input order does not decide the answer', () => {
        // The list arrives from a table with no guaranteed order.
        const forwards = versionForInspection('tx_trec_rei', t('2022-03-01'), [TX_OLD, TX_NEW]);
        const backwards = versionForInspection('tx_trec_rei', t('2022-03-01'), [TX_NEW, TX_OLD]);
        expect(forwards?.version).toBe('7-6');
        expect(backwards?.version).toBe('7-6');
    });

    it('a revision that was never made mandatory is never the default', () => {
        // `mandatoryFrom: null` means "publishable, never required". It stays
        // selectable, but it can only be reached by an explicit choice.
        const voluntaryOnly: StatutoryFormVersion = {
            ...TX_NEW, version: '7-6-draft', mandatoryFrom: null,
        };
        expect(versionForInspection('tx_trec_rei', t('2026-01-01'), [TX_OLD, voluntaryOnly])?.version)
            .toBe('7-6-draft');
        // ...but only because nothing else covers that date. With a mandatory
        // revision in scope, the mandatory one wins.
        expect(versionForInspection('tx_trec_rei', t('2026-01-01'), [TX_NEW, voluntaryOnly])?.version)
            .toBe('7-6');
    });
});

describe('selectableVersions', () => {
    it('returns BOTH revisions inside a voluntary-use window', () => {
        // The point of the pair: `versionForInspection` answers "which one by
        // default", this answers "which ones may the inspector pick". Collapsing
        // them into one function is how the choice disappears.
        const usable = selectableVersions('tx_trec_rei', t('2021-11-01'), TX_VERSIONS);
        expect(usable.map((v) => v.version)).toEqual(['7-5', '7-6']);
    });

    it('POSITIVE CONTROL — outside the window there is exactly one', () => {
        expect(selectableVersions('tx_trec_rei', t('2021-08-31'), TX_VERSIONS).map((v) => v.version))
            .toEqual(['7-5']);
        expect(selectableVersions('tx_trec_rei', t('2022-02-01'), TX_VERSIONS).map((v) => v.version))
            .toEqual(['7-6']);
    });

    it('returns an empty list, not a nearest guess, before any revision', () => {
        expect(selectableVersions('tx_trec_rei', t('2000-01-01'), TX_VERSIONS)).toEqual([]);
    });

    it('is ordered oldest first regardless of input order', () => {
        const usable = selectableVersions('tx_trec_rei', t('2021-11-01'), [TX_NEW, TX_OLD]);
        expect(usable.map((v) => v.version)).toEqual(['7-5', '7-6']);
    });
});
