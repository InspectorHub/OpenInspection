/**
 * `revisionStatusField` is what GET /api/inspections/{id} spreads into its response: the status under its key when
 * the judgement has something to say, and nothing at all (no key, not a null) when it does not.
 */
import { describe, it, expect } from 'vitest';
import { revisionStatusField } from '../../../server/api/inspections/patch-revision-report';
import type { StatutoryFormVersion } from '../../../server/lib/statutory/form-registry';

const v = (version: string, over: Partial<StatutoryFormVersion> = {}): StatutoryFormVersion => ({
    formId: 'tx_trec_rei',
    formTitle: 'Test Form',
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

const snapshot = (revision?: string) => ({
    schemaVersion: 2,
    sections: [],
    statutoryForm: { formId: 'tx_trec_rei', bindings: {}, ...(revision === undefined ? {} : { revision }) },
});

describe('revisionStatusField', () => {
    const NOW = Date.UTC(2026, 0, 10);

    it('carries a current status under the key', () => {
        expect(revisionStatusField({ date: '2026-01-10', templateSnapshot: snapshot('7-6') }, NOW, [v('7-6')]))
            .toStrictEqual({ revisionStatus: { kind: 'current' } });
    });

    it('carries a warning before a cutover', () => {
        const versions = [v('7-6'), v('7-7', { mandatoryFrom: Date.UTC(2026, 0, 20) })];
        expect(revisionStatusField({ date: '2026-01-10', templateSnapshot: snapshot('7-6') }, NOW, versions))
            .toStrictEqual({ revisionStatus: { kind: 'superseding_soon', nextVersion: '7-7', from: Date.UTC(2026, 0, 20) } });
    });

    it('carries a withdrawn revision with its reason', () => {
        const versions = [v('7-6', { withdrawn: { reason: 'authority_withdrew', at: Date.UTC(2025, 5, 1) } })];
        const out = revisionStatusField({ date: '2026-01-10', templateSnapshot: snapshot('7-6') }, NOW, versions);
        expect(out).toHaveProperty('revisionStatus.kind', 'withdrawn');
    });

    it('is empty, with no key at all, when the snapshot declares no statutory form', () => {
        const out = revisionStatusField({ date: '2026-01-10', templateSnapshot: { schemaVersion: 2, sections: [] } }, NOW, [v('7-6')]);
        expect(out).toStrictEqual({});
        expect(Object.keys(out)).toEqual([]);
    });

    it('is empty when the declaration names no revision, the date is malformed, or there is no snapshot', () => {
        expect(revisionStatusField({ date: '2026-01-10', templateSnapshot: snapshot() }, NOW, [v('7-6')])).toStrictEqual({});
        expect(revisionStatusField({ date: 'soon', templateSnapshot: snapshot('7-6') }, NOW, [v('7-6')])).toStrictEqual({});
        expect(revisionStatusField({ date: '2026-01-10', templateSnapshot: null }, NOW, [v('7-6')])).toStrictEqual({});
    });

    it('reads only the calendar day of a date that carries a time', () => {
        expect(revisionStatusField({ date: '2026-01-10T14:30:00.000Z', templateSnapshot: snapshot('7-6') }, NOW, [v('7-6')]))
            .toStrictEqual({ revisionStatus: { kind: 'current' } });
    });
});
