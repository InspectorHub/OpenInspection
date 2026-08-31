/**
 * Noticing that an authority changed its form, and never acting on it.
 *
 * ── The asymmetry this file is built around ─────────────────────────────────
 * A watcher that only REPORTS costs nothing when it misses: somebody finds the
 * new revision the ordinary way, a week later. A watcher that REPLACES costs an
 * inspector the wrong statutory form, filled in, signed, and filed with the
 * state — and it costs it silently, because both documents look official.
 *
 * So the assertions below are not "detection works". They are that detection
 * CANNOT reach adoption: that a sighting carries none of the facts a
 * publication needs, and that the closest thing detection could possibly hand
 * `versionForInspection` comes back as nothing.
 */
import { describe, it, expect } from 'vitest';
import {
    classifySighting,
    watchTargets,
    type RevisionSighting,
} from '../../../server/lib/statutory/revision-watch';
import {
    versionForInspection,
    type StatutoryFormVersion,
} from '../../../server/lib/statutory/form-registry';

/** A UTC midnight epoch-ms for a civil date, so no fixture depends on the host zone. */
const t = (isoDate: string): number => Date.parse(`${isoDate}T00:00:00.000Z`);

const TREC = 'https://www.trec.texas.gov/forms/rei-7-6.pdf';

const base = {
    formId: 'tx_trec_rei',
    formTitle: 'Yankee Flat Form',
    sourceUrl: TREC,
    publishedBy: 'platform',
    publishedAt: t('2026-08-21'),
    withdrawn: null,
};

const PUBLISHED_75: StatutoryFormVersion = {
    ...base,
    version: '7-5',
    sourceHash: 'a'.repeat(64),
    effectiveFrom: t('2015-02-01'),
    mandatoryFrom: t('2015-02-01'),
    effectiveUntil: t('2022-02-01'),
};
const PUBLISHED_76: StatutoryFormVersion = {
    ...base,
    version: '7-6',
    sourceHash: 'b'.repeat(64),
    effectiveFrom: t('2021-09-01'),
    mandatoryFrom: t('2022-02-01'),
    effectiveUntil: null,
};
const CATALOGUE = [PUBLISHED_75, PUBLISHED_76];

describe('watchTargets: we poll only what we publish', () => {
    it('carries no target at all for an empty catalogue', () => {
        // Not an optimisation. There is nothing to compare an unpublished
        // form's bytes AGAINST, so a poll of one could only produce a verdict
        // we invented — and this deployment publishes no statutory form today,
        // which is why the scheduled check costs it nothing.
        expect(watchTargets([])).toEqual([]);
    });

    it('collapses two revisions served from one page into one poll', () => {
        // The real shape: an authority keeps a stable "current form" URL and
        // changes what it serves. Polling it twice would fetch the same bytes
        // twice and record the same sighting twice.
        expect(watchTargets(CATALOGUE)).toEqual([
            { formId: 'tx_trec_rei', sourceUrl: TREC },
        ]);
    });

    it('keeps two pages of the same form apart', () => {
        const elsewhere: StatutoryFormVersion = {
            ...PUBLISHED_76,
            version: '7-7',
            sourceUrl: 'https://www.trec.texas.gov/forms/rei-7-7.pdf',
        };
        expect(watchTargets([...CATALOGUE, elsewhere])).toHaveLength(2);
    });
});

describe('classifySighting: what the page is serving now', () => {
    it('is unchanged when the bytes are a revision we already publish', () => {
        const seen = classifySighting(CATALOGUE, {
            formId: 'tx_trec_rei', sourceUrl: TREC,
            observedHash: 'b'.repeat(64), observedAt: t('2026-08-23'),
        });
        expect(seen.verdict).toBe('unchanged');
    });

    it('is unchanged for a SUPERSEDED revision we still publish', () => {
        // The overlap case, and the reason the comparison is against every
        // published revision rather than against the newest one. During a
        // voluntary-use window the page may legitimately serve either, and
        // calling the older one "changed" would raise an alarm every day.
        const seen = classifySighting(CATALOGUE, {
            formId: 'tx_trec_rei', sourceUrl: TREC,
            observedHash: 'a'.repeat(64), observedAt: t('2026-08-23'),
        });
        expect(seen.verdict).toBe('unchanged');
    });

    it('is changed when the bytes match no revision we publish', () => {
        const seen = classifySighting(CATALOGUE, {
            formId: 'tx_trec_rei', sourceUrl: TREC,
            observedHash: 'c'.repeat(64), observedAt: t('2026-08-23'),
        });
        expect(seen.verdict).toBe('changed');
    });

    it('refuses to call anything changed for a form it publishes no revision of', () => {
        // The positive control on the line above. "Changed" is a comparison,
        // and with nothing on our side of it the honest answer is that we
        // cannot say — not the alarming one.
        const seen = classifySighting(CATALOGUE, {
            formId: 'fl_oir_b1_1802', sourceUrl: 'https://example.gov/1802.pdf',
            observedHash: 'c'.repeat(64), observedAt: t('2026-08-23'),
        });
        expect(seen.verdict).toBe('unrecognised');
    });
});

describe('a sighting is not a version, and cannot be turned into one', () => {
    const seen: RevisionSighting = classifySighting(CATALOGUE, {
        formId: 'tx_trec_rei', sourceUrl: TREC,
        observedHash: 'c'.repeat(64), observedAt: t('2026-08-23'),
    });

    it('carries these five facts and no others', () => {
        // An equality, not a list of absences. A test that named three keys
        // that must not appear would only ever test the three somebody thought
        // of; this one fails the day a sixth field is added, whatever it is.
        expect(Object.keys(seen).sort()).toEqual([
            'formId', 'observedAt', 'observedHash', 'sourceUrl', 'verdict',
        ]);
    });

    it('knows nothing about when the revision applies or who stood behind it', () => {
        // Said again from the other side, because this is the property that
        // matters: these are exactly the facts a publication decision supplies,
        // and detection cannot supply any of them. It read a page.
        for (const key of ['effectiveFrom', 'mandatoryFrom', 'effectiveUntil', 'publishedBy']) {
            expect(key in seen).toBe(false);
        }
    });

    it('cannot be selected by versionForInspection even when copied into the shape', () => {
        // The blur this whole task exists to prevent, written out: somebody
        // takes what the watcher learned and fills a version row with it. The
        // publication facts are the ones detection does not have, so they come
        // out blank — and a row with them blank is not a published revision.
        const copied: StatutoryFormVersion = {
            formId: seen.formId,
            formTitle: 'Yankee Flat Form',
            version: 'unknown',
            sourceUrl: seen.sourceUrl,
            sourceHash: seen.observedHash,
            effectiveFrom: seen.observedAt,
            mandatoryFrom: null,
            effectiveUntil: null,
            publishedBy: '',
            publishedAt: 0,
            withdrawn: null,
        };
        expect(versionForInspection('tx_trec_rei', t('2026-08-23'), [copied])).toBeNull();
    });

    it('IS selected once a person has published it — the positive control', () => {
        // Without this the assertion above passes for a function that returns
        // null on everything. The only difference between the two objects is
        // the publication decision.
        const published: StatutoryFormVersion = {
            formId: 'tx_trec_rei',
            formTitle: 'Yankee Flat Form',
            version: '7-7',
            sourceUrl: TREC,
            sourceHash: 'c'.repeat(64),
            effectiveFrom: t('2026-08-01'),
            mandatoryFrom: t('2026-08-01'),
            effectiveUntil: null,
            publishedBy: 'platform',
            publishedAt: t('2026-08-22'),
            withdrawn: null,
        };
        expect(versionForInspection('tx_trec_rei', t('2026-08-23'), [published])?.version)
            .toBe('7-7');
    });
});
