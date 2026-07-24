/**
 * IA-31 — `/agent-recommendations` returned empty for every agent because
 * flattenInspectionToRecommendations read the stored defect states by the bare
 * itemId (not the composite findingKey) AND skipped the `.tabs` layer, so
 * defectStates was always []. These specs pin the storage-shaped read: the
 * fixture is keyed exactly as inspection_results.data is written
 * (`_default:{sectionId}:{itemId}` → `.tabs.defects[]`).
 */
import { describe, it, expect } from 'vitest';
import { flattenInspectionToRecommendations, groupRecommendations, type AgentRecommendationRow, type RawInspectionForRecommendations } from '../../../server/services/agent-recommendations';

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
    return {
        id: 'insp-1',
        tenantName: 'Acme Inspections',
        tenantSlug: 'acme',
        propertyAddress: '1 Main St',
        date: '2026-06-01',
        templateSnapshot: snapshot,
        resultsData,
    };
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

    it('carries the owning company onto every row (property grouping + share channel need it)', () => {
        const rows = flattenInspectionToRecommendations(raw({
            '_default:s_roof:i_shingles': { tabs: { defects: [{ cannedId: 'd_missing', included: true }] } },
        }));
        expect(rows[0].tenantName).toBe('Acme Inspections');
        expect(rows[0].tenantSlug).toBe('acme');
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

// IA-41 — the agent feed was the only consumer that dropped field-added custom
// defects and defects tagged with a tenant custom category. Both must surface.
const snap2 = {
    sections: [{
        id: 's', title: 'Sec',
        items: [{ id: 'it', label: 'Item', tabs: { defects: [{ id: 'dc', title: 'Canned', category: 'Environmental', comment: 'c' }] } }],
    }],
};
const raw2 = (resultsData: unknown): RawInspectionForRecommendations =>
    ({ id: 'i', tenantName: 'Acme Inspections', tenantSlug: 'acme', propertyAddress: 'A', date: 'd', templateSnapshot: snap2, resultsData });

describe('flattenInspectionToRecommendations — custom defects + tenant categories (IA-41)', () => {
    it('surfaces field-added custom defects with isCustom=true', () => {
        const rows = flattenInspectionToRecommendations(raw2({
            '_default:s:it': { customComments: { defects: [{ id: 'cd1', title: 'Cracked pane', comment: 'note', category: 'safety', included: true }] } },
        }));
        const custom = rows.find((r) => r.defectTitle === 'Cracked pane');
        expect(custom).toBeTruthy();
        expect(custom?.isCustom).toBe(true);
        expect(custom?.category).toBe('safety');
        expect(custom?.comment).toBe('note');
    });

    it('does not drop a defect tagged with a tenant custom category', () => {
        const rows = flattenInspectionToRecommendations(raw2({
            '_default:s:it': { tabs: { defects: [{ cannedId: 'dc', included: true }] } },
        }));
        expect(rows).toHaveLength(1);
        expect(rows[0].category).toBe('Environmental');
        expect(rows[0].isCustom).toBe(false);
    });

    it('excludes custom defects marked not included', () => {
        const rows = flattenInspectionToRecommendations(raw2({
            '_default:s:it': { customComments: { defects: [{ id: 'cd1', title: 'X', comment: '', category: 'safety', included: false }] } },
        }));
        expect(rows).toHaveLength(0);
    });
});

describe('groupRecommendations — custom categories merge into recommendation (IA-41)', () => {
    const row = (category: string, isCustom = false): AgentRecommendationRow => ({
        inspectionId: 'i', tenantName: 'Acme Inspections', tenantSlug: 'acme',
        propertyAddress: 'A', inspectionDate: 'd', sectionTitle: 'S',
        itemLabel: 'I', defectTitle: 'D', category, comment: '', location: null, photos: [], isCustom,
    });
    it('files safety and maintenance directly; recommendation + any custom category merge into recommendation', () => {
        const g = groupRecommendations([row('safety'), row('maintenance'), row('recommendation'), row('Environmental'), row('Historic', true)]);
        expect(g.safety).toHaveLength(1);
        expect(g.maintenance).toHaveLength(1);
        expect(g.recommendation).toHaveLength(3);
        expect(g.recommendation.map((r) => r.category)).toContain('Environmental');
    });
});
