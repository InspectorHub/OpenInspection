import { describe, it, expect } from 'vitest';
import {
    findingKey,
    parseFindingKey,
    findingsForUnit,
    isLegacyKey,
    migrateLegacyKey,
    findingKeysFromTemplateSnapshot,
    DEFAULT_UNIT,
} from '../../../server/lib/finding-key';

describe('findingKey', () => {
    it('builds 3-part key with unitId', () => {
        expect(findingKey('unit-abc', 'roof', 'roof-covering')).toBe('unit-abc:roof:roof-covering');
    });

    it('uses _default when unitId is null', () => {
        expect(findingKey(null, 'electrical', 'elec-panel')).toBe('_default:electrical:elec-panel');
    });

    it('uses _default when unitId is undefined', () => {
        expect(findingKey(undefined, 'plumbing', 'plumb-supply')).toBe('_default:plumbing:plumb-supply');
    });

    it('uses _default when unitId is empty string', () => {
        expect(findingKey('', 'hvac', 'hvac-unit')).toBe('_default:hvac:hvac-unit');
    });
});

describe('parseFindingKey', () => {
    it('parses 3-part key', () => {
        expect(parseFindingKey('unit-abc:roof:roof-covering')).toEqual({
            unitId: 'unit-abc',
            sectionId: 'roof',
            itemId: 'roof-covering',
        });
    });

    it('parses _default unit key', () => {
        expect(parseFindingKey('_default:electrical:elec-panel')).toEqual({
            unitId: '_default',
            sectionId: 'electrical',
            itemId: 'elec-panel',
        });
    });

    it('handles legacy 1-part key (itemId only)', () => {
        expect(parseFindingKey('item-001')).toEqual({
            unitId: '_default',
            sectionId: '',
            itemId: 'item-001',
        });
    });

    it('handles legacy 2-part key (sectionId:itemId)', () => {
        expect(parseFindingKey('roof:roof-covering')).toEqual({
            unitId: '_default',
            sectionId: 'roof',
            itemId: 'roof-covering',
        });
    });

    it('roundtrips through findingKey', () => {
        const key = findingKey('unit-xyz', 'exterior', 'ext-siding');
        const parsed = parseFindingKey(key);
        expect(parsed).toEqual({ unitId: 'unit-xyz', sectionId: 'exterior', itemId: 'ext-siding' });
        expect(findingKey(parsed.unitId, parsed.sectionId, parsed.itemId)).toBe(key);
    });
});

describe('findingsForUnit', () => {
    const data: Record<string, unknown> = {
        '_default:roof:roof-covering': { rating: 'SAT' },
        '_default:electrical:elec-panel': { rating: 'DEF' },
        'unit-abc:roof:roof-covering': { rating: 'MON' },
        'unit-abc:electrical:elec-panel': { rating: 'SAT' },
        'unit-xyz:roof:roof-covering': { rating: 'DEF' },
    };

    it('filters by _default unit', () => {
        const result = findingsForUnit(data, '_default');
        expect(Object.keys(result)).toHaveLength(2);
        expect(result['_default:roof:roof-covering']).toEqual({ rating: 'SAT' });
        expect(result['_default:electrical:elec-panel']).toEqual({ rating: 'DEF' });
    });

    it('filters by specific unit', () => {
        const result = findingsForUnit(data, 'unit-abc');
        expect(Object.keys(result)).toHaveLength(2);
        expect(result['unit-abc:roof:roof-covering']).toEqual({ rating: 'MON' });
    });

    it('returns empty for unknown unit', () => {
        const result = findingsForUnit(data, 'unit-unknown');
        expect(Object.keys(result)).toHaveLength(0);
    });
});

describe('isLegacyKey', () => {
    it('detects 1-part legacy key', () => {
        expect(isLegacyKey('item-001')).toBe(true);
    });

    it('detects 2-part legacy key', () => {
        expect(isLegacyKey('roof:roof-covering')).toBe(true);
    });

    it('returns false for 3-part key', () => {
        expect(isLegacyKey('_default:roof:roof-covering')).toBe(false);
    });
});

describe('migrateLegacyKey', () => {
    it('converts itemId + sectionId to composite key', () => {
        expect(migrateLegacyKey('item-001', 'roof')).toBe('_default:roof:item-001');
    });
});

describe('DEFAULT_UNIT', () => {
    it('is _default', () => {
        expect(DEFAULT_UNIT).toBe('_default');
    });
});

describe('findingKeysFromTemplateSnapshot', () => {
    it('enumerates a v2 {sections:[...]} snapshot', () => {
        const snap = { sections: [{ id: 's1', items: [{ id: 'i1' }, { id: 'i2' }] }] };
        expect(findingKeysFromTemplateSnapshot(snap)).toEqual([
            '_default:s1:i1',
            '_default:s1:i2',
        ]);
    });

    it('enumerates multiple sections', () => {
        const snap = {
            sections: [
                { id: 'roof', items: [{ id: 'covering' }] },
                { id: 'electrical', items: [{ id: 'panel' }, { id: 'wiring' }] },
            ],
        };
        expect(findingKeysFromTemplateSnapshot(snap)).toEqual([
            '_default:roof:covering',
            '_default:electrical:panel',
            '_default:electrical:wiring',
        ]);
    });

    it('treats a flat legacy array as a single "general" section', () => {
        const snap = [{ id: 'a1' }, { id: 'a2' }];
        expect(findingKeysFromTemplateSnapshot(snap)).toEqual([
            '_default:general:a1',
            '_default:general:a2',
        ]);
    });

    it('parses a JSON STRING snapshot', () => {
        const snap = JSON.stringify({ sections: [{ id: 's1', items: [{ id: 'i1' }] }] });
        expect(findingKeysFromTemplateSnapshot(snap)).toEqual(['_default:s1:i1']);
    });

    it('skips items with empty/missing id', () => {
        const snap = { sections: [{ id: 's1', items: [{ id: '' }, {}, { id: 'i3' }] }] };
        expect(findingKeysFromTemplateSnapshot(snap)).toEqual(['_default:s1:i3']);
    });

    it('coerces non-string section/item ids to strings', () => {
        const snap = { sections: [{ id: 5, items: [{ id: 7 }] }] };
        expect(findingKeysFromTemplateSnapshot(snap)).toEqual(['_default:5:7']);
    });

    it('returns [] for null/empty/garbage input (never throws)', () => {
        expect(findingKeysFromTemplateSnapshot(null)).toEqual([]);
        expect(findingKeysFromTemplateSnapshot(undefined)).toEqual([]);
        expect(findingKeysFromTemplateSnapshot({})).toEqual([]);
        expect(findingKeysFromTemplateSnapshot('not json')).toEqual([]);
        expect(findingKeysFromTemplateSnapshot(42)).toEqual([]);
        expect(findingKeysFromTemplateSnapshot({ sections: 'nope' })).toEqual([]);
    });
});
