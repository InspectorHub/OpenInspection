/**
 * IA-31 — `/agent-recommendations` returned empty for every agent because
 * flattenInspectionToRecommendations read the stored defect states by the bare
 * itemId (not the composite findingKey) AND skipped the `.tabs` layer, so
 * defectStates was always []. These specs pin the storage-shaped read: the
 * fixture is keyed exactly as inspection_results.data is written
 * (`_default:{sectionId}:{itemId}` → `.tabs.defects[]`).
 */
import { describe, it, expect } from 'vitest';
import { flattenInspectionToRecommendations, type RawInspectionForRecommendations } from '../../../server/services/agent-recommendations';

const snapshot = {
    sections: [{
        id: 's_roof',
        title: 'Roof',
        items: [{
            id: 'i_shingles',
            label: 'Shingles',
            tabs: { defects: [{ id: 'd_missing', title: 'Missing shingles', category: 'safety', comment: 'Replace missing shingles.' }] },
        }],
    }],
};

function raw(resultsData: unknown): RawInspectionForRecommendations {
    return { id: 'insp-1', propertyAddress: '1 Main St', date: '2026-06-01', templateSnapshot: snapshot, resultsData };
}

describe('flattenInspectionToRecommendations — storage-shaped results', () => {
    it('reads defect state from the canonical _default:section:item key with the tabs layer', () => {
        const rows = flattenInspectionToRecommendations(raw({
            '_default:s_roof:i_shingles': { tabs: { defects: [{ cannedId: 'd_missing', included: true }] } },
        }));
        expect(rows).toHaveLength(1);
        expect(rows[0].defectTitle).toBe('Missing shingles');
        expect(rows[0].category).toBe('safety');
        expect(rows[0].itemLabel).toBe('Shingles');
    });

    it('still reads a legacy bare-itemId row (pre-composite-key fallback), also under .tabs', () => {
        const rows = flattenInspectionToRecommendations(raw({
            'i_shingles': { tabs: { defects: [{ cannedId: 'd_missing', included: true }] } },
        }));
        expect(rows).toHaveLength(1);
        expect(rows[0].defectTitle).toBe('Missing shingles');
    });

    it('excludes defects the field marked not included', () => {
        const rows = flattenInspectionToRecommendations(raw({
            '_default:s_roof:i_shingles': { tabs: { defects: [{ cannedId: 'd_missing', included: false }] } },
        }));
        expect(rows).toHaveLength(0);
    });

    it('returns nothing when there are no recorded results', () => {
        expect(flattenInspectionToRecommendations(raw({}))).toHaveLength(0);
    });
});
