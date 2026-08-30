/**
 * The one criterion, exercised at each of its five answers.
 *
 * Every assertion here is about a DATE BOUNDARY, which is the reason the
 * criterion is a single function in the first place: nobody tests a date
 * boundary by hand, so two implementations of it disagree quietly and for a
 * long time.
 */
import { describe, it, expect } from 'vitest';
import { revisionStatus } from '../../../server/lib/statutory/revision-status';
import type { StatutoryFormVersion } from '../../../server/lib/statutory/form-registry';

const v = (version: string, over: Partial<StatutoryFormVersion> = {}): StatutoryFormVersion => ({
    formId: 'tx_trec_rei',
    version,
    effectiveFrom: Date.UTC(2024, 0, 1),
    mandatoryFrom: null,
    effectiveUntil: null,
    withdrawn: null,
    sourceUrl: 'https://www.trec.texas.gov/x.pdf',
    sourceHash: 'a'.repeat(64),
    publishedBy: 'platform',
    publishedAt: Date.UTC(2024, 0, 1),
    ...over,
});

const VERSIONS: readonly StatutoryFormVersion[] = [
    v('7-6'),
    v('7-7', { mandatoryFrom: Date.UTC(2026, 2, 15) }),
];

describe('revisionStatus', () => {
    it('current when nothing newer is mandated yet and none is near', () => {
        expect(revisionStatus({
            formId: 'tx_trec_rei',
            inspectionDate: '2026-01-10',
            installedVersion: '7-6',
            versions: VERSIONS,
            now: Date.UTC(2026, 0, 10),
        })).toEqual({ kind: 'current' });
    });

    it('warns before the cutover, without blocking anything', () => {
        const s = revisionStatus({
            formId: 'tx_trec_rei',
            inspectionDate: '2026-03-01',
            installedVersion: '7-6',
            versions: VERSIONS,
            now: Date.UTC(2026, 2, 1),
            warnWindowDays: 30,
        });
        expect(s).toEqual({
            kind: 'superseding_soon', nextVersion: '7-7', from: Date.UTC(2026, 2, 15),
        });
    });

    it('after the cutover, an inspection dated BEFORE it is explicitly fine', () => {
        // The state that must be SAID, not stayed silent on. An inspector who
        // sees "superseded" and no explanation assumes their report is wrong.
        const s = revisionStatus({
            formId: 'tx_trec_rei',
            inspectionDate: '2026-03-01',
            installedVersion: '7-6',
            versions: VERSIONS,
            now: Date.UTC(2026, 2, 20),
        });
        expect(s).toEqual({
            kind: 'superseded_elsewhere', nextVersion: '7-7', from: Date.UTC(2026, 2, 15),
        });
    });

    it('refuses only when the inspection itself falls under the newer revision', () => {
        const s = revisionStatus({
            formId: 'tx_trec_rei',
            inspectionDate: '2026-03-20',
            installedVersion: '7-6',
            versions: VERSIONS,
            now: Date.UTC(2026, 2, 20),
        });
        expect(s).toEqual({
            kind: 'cannot_produce', applicableVersion: '7-7', templateVersion: '7-6',
        });
    });

    it('a withdrawn successor is not a cutover anybody has to be warned about', () => {
        // The positive control for the `withdrawn` filter. Without it a
        // predicate that ignored withdrawal would pass every assertion above:
        // none of them carries a withdrawn revision at all.
        const withdrawn = [
            v('7-6'),
            v('7-7', {
                mandatoryFrom: Date.UTC(2026, 2, 15),
                withdrawn: { at: Date.UTC(2026, 1, 1), reason: 'authority_withdrew' },
            }),
        ];
        expect(revisionStatus({
            formId: 'tx_trec_rei',
            inspectionDate: '2026-03-01',
            installedVersion: '7-6',
            versions: withdrawn,
            now: Date.UTC(2026, 2, 1),
            warnWindowDays: 30,
        })).toEqual({ kind: 'current' });
    });

    it('another form\'s cutover is not this form\'s business', () => {
        // The second positive control. A filter that dropped the formId test
        // would report a Florida cutover on a Texas inspection.
        const mixed = [
            v('7-6'),
            v('Rev. 04/26', { formId: 'fl_oir_b1_1802', mandatoryFrom: Date.UTC(2026, 2, 15) }),
        ];
        expect(revisionStatus({
            formId: 'tx_trec_rei',
            inspectionDate: '2026-03-01',
            installedVersion: '7-6',
            versions: mixed,
            now: Date.UTC(2026, 2, 1),
            warnWindowDays: 30,
        })).toEqual({ kind: 'current' });
    });

    it('reports the installed revision being withdrawn, with the reason', () => {
        // Before this state existed, this exact catalogue produced silence: the
        // withdrawn revision is filtered out of selection, nothing else covers
        // 2026-01-10, and `applicable === null` returned `current`. The one
        // fault in this subsystem that has already put wrong documents in
        // somebody's hands was the one nothing said a word about.
        const withdrawal = { at: Date.UTC(2026, 0, 5), reason: 'field_map_incorrect' } as const;
        expect(revisionStatus({
            formId: 'tx_trec_rei',
            inspectionDate: '2026-01-10',
            installedVersion: '7-6',
            versions: [v('7-6', { withdrawn: withdrawal })],
            now: Date.UTC(2026, 0, 20),
        })).toEqual({
            kind: 'withdrawn',
            version: '7-6',
            // Read back from the catalogue's own value rather than retyped, so
            // a status that hard-coded one reason could not pass.
            reason: withdrawal.reason,
            withdrawnAt: withdrawal.at,
            replacementVersion: null,
        });
    });

    it('carries the other reason through unchanged — it is not a fixed word', () => {
        // The positive control for the assertion above: the same catalogue
        // shape, the other reason, and the answer differs in exactly that field.
        const withdrawal = { at: Date.UTC(2026, 0, 5), reason: 'authority_withdrew' } as const;
        const status = revisionStatus({
            formId: 'tx_trec_rei',
            inspectionDate: '2026-01-10',
            installedVersion: '7-6',
            versions: [v('7-6', { withdrawn: withdrawal })],
            now: Date.UTC(2026, 0, 20),
        });
        expect(status).toMatchObject({ kind: 'withdrawn', reason: withdrawal.reason });
    });

    it('names the revision now in force when there is one', () => {
        // The workspace's next step is only expressible when a replacement
        // exists, and the two reasons ask for different things to be done with
        // it. Selecting it here rather than in the copy keeps that one date
        // comparison in the one function that owns date comparisons.
        expect(revisionStatus({
            formId: 'tx_trec_rei',
            inspectionDate: '2026-04-01',
            installedVersion: '7-6',
            versions: [
                v('7-6', {
                    withdrawn: { at: Date.UTC(2026, 2, 1), reason: 'authority_withdrew' },
                }),
                v('7-7', { mandatoryFrom: Date.UTC(2026, 2, 15) }),
            ],
            now: Date.UTC(2026, 3, 2),
        })).toEqual({
            kind: 'withdrawn',
            version: '7-6',
            reason: 'authority_withdrew',
            withdrawnAt: Date.UTC(2026, 2, 1),
            replacementVersion: '7-7',
        });
    });

    it('outranks cannot_produce: the withdrawal is the thing to say', () => {
        // Without the ordering this asserts, the same inputs answer
        // `cannot_produce`, whose copy explains that the template was built
        // against a DIFFERENT document — true, and about the wrong problem. The
        // control is that a live 7-6 in the same shape DOES answer
        // `cannot_produce`, so this is an ordering test and not a tautology.
        const live = [v('7-6'), v('7-7', { mandatoryFrom: Date.UTC(2026, 2, 15) })];
        const input = {
            formId: 'tx_trec_rei',
            inspectionDate: '2026-04-01',
            installedVersion: '7-6',
            now: Date.UTC(2026, 3, 2),
        };
        expect(revisionStatus({ ...input, versions: live }).kind).toBe('cannot_produce');
        expect(revisionStatus({
            ...input,
            versions: [
                v('7-6', {
                    withdrawn: { at: Date.UTC(2026, 2, 1), reason: 'field_map_incorrect' },
                }),
                v('7-7', { mandatoryFrom: Date.UTC(2026, 2, 15) }),
            ],
        }).kind).toBe('withdrawn');
    });

    it('a withdrawal on some OTHER revision is not this inspection\'s news', () => {
        // The positive control for reading the INSTALLED revision. A check that
        // asked "is any revision withdrawn" would fire here, where the template
        // produces a perfectly live 7-6.
        expect(revisionStatus({
            formId: 'tx_trec_rei',
            inspectionDate: '2026-01-10',
            installedVersion: '7-6',
            versions: [
                v('7-6'),
                v('7-5', {
                    effectiveFrom: Date.UTC(2023, 0, 1),
                    withdrawn: { at: Date.UTC(2026, 0, 5), reason: 'field_map_incorrect' },
                }),
            ],
            now: Date.UTC(2026, 0, 20),
        })).toEqual({ kind: 'current' });
    });

    it('says nothing when no revision covers the inspection at all', () => {
        // An inspection dated before every revision we hold. The produce path
        // already refuses it by name (`produce.service.ts` fails with "no
        // published revision covers ..."), and inventing a second, differently
        // worded alarm here would tell an inspector the template is out of date
        // when the truth is that this deployment publishes nothing for the date.
        expect(revisionStatus({
            formId: 'tx_trec_rei',
            inspectionDate: '2023-06-01',
            installedVersion: '7-6',
            versions: VERSIONS,
            now: Date.UTC(2023, 5, 1),
        })).toEqual({ kind: 'current' });
    });
});
