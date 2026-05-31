import { describe, it, expect } from 'vitest';
import { computePublishReadinessFromState } from '../../server/services/inspection.service';

describe('computePublishReadinessFromState', () => {
    const schema = {
        sections: [{
            id: 'sec1', title: 'Roof', items: [{
                id: 'item1', label: 'Roof Covering', type: 'rich',
                tabs: { information: [], limitations: [], defects: [
                    { id: 'rd1', title: 'Missing shingles', category: 'safety', location: '', comment: 'Repair at {{location}} by {{trade}}.', photos: [], default: false },
                ] },
            }],
        }],
    } as any;

    it('returns ready=true when all included defects have location + trade', () => {
        const results = {
            item1: { tabs: { defects: [{
                cannedId: 'rd1', included: true,
                location: 'SE corner', trade: 'licensed-roofer',
            }] } },
        };
        const r = computePublishReadinessFromState(schema, results);
        expect(r.ready).toBe(true);
        expect(r.blockingDefects).toHaveLength(0);
    });

    it('blocks when location is missing on an included defect', () => {
        const results = {
            item1: { tabs: { defects: [{
                cannedId: 'rd1', included: true, trade: 'licensed-roofer',
            }] } },
        };
        const r = computePublishReadinessFromState(schema, results);
        expect(r.ready).toBe(false);
        expect(r.blockingDefects).toHaveLength(1);
        expect(r.blockingDefects[0].missing).toEqual(['location']);
    });

    it('blocks when trade is missing', () => {
        const results = {
            item1: { tabs: { defects: [{
                cannedId: 'rd1', included: true, location: 'SE corner',
            }] } },
        };
        const r = computePublishReadinessFromState(schema, results);
        expect(r.ready).toBe(false);
        expect(r.blockingDefects[0].missing).toEqual(['trade']);
    });

    it('ignores non-included defects', () => {
        const results = {
            item1: { tabs: { defects: [{
                cannedId: 'rd1', included: false,
            }] } },
        };
        const r = computePublishReadinessFromState(schema, results);
        expect(r.ready).toBe(true);
    });

    it('accepts template default location as a fallback when state.location is empty', () => {
        const schemaWithDefault = {
            sections: [{
                id: 'sec1', title: 'Roof', items: [{
                    id: 'item1', label: 'Roof Covering', type: 'rich',
                    tabs: { information: [], limitations: [], defects: [
                        { id: 'rd1', title: 'X', category: 'safety', location: 'pre-filled', comment: 'X', photos: [], default: false },
                    ] },
                }],
            }],
        } as any;
        const results = {
            item1: { tabs: { defects: [{
                cannedId: 'rd1', included: true, trade: 'licensed-roofer',
            }] } },
        };
        const r = computePublishReadinessFromState(schemaWithDefault, results);
        expect(r.ready).toBe(true);
    });
});
