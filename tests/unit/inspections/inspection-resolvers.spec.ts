import { describe, it, expect } from 'vitest';
import {
    findUnit,
    findBuildingOfUnit,
    resolveUnitSections,
    resolveUnitSectionItems,
} from '../../../server/lib/inspection-resolvers';
import type { TemplateSchemaV2 } from '../../../server/types/template-schema';

const structure = {
    buildings: [
        {
            id: 'b1', name: 'Building A',
            units: [
                { id: 'u1', name: 'Unit 101', type: 'unit' as const },
                { id: 'u2', name: 'Lobby', type: 'common' as const },
            ],
        },
        {
            id: 'b2', name: 'Building B',
            units: [{ id: 'u3', name: 'Unit 201', type: 'unit' as const }],
        },
    ],
};

const schema: TemplateSchemaV2 = {
    schemaVersion: 2,
    sections: [
        { id: 'roof', title: 'Roof', items: [{ id: 'roof-1', label: 'Covering', type: 'rich' }, { id: 'roof-2', label: 'Flashing', type: 'rich' }] },
        { id: 'elec', title: 'Electrical', items: [{ id: 'elec-1', label: 'Panel', type: 'rich' }] },
        { id: 'hvac', title: 'HVAC', items: [{ id: 'hvac-1', label: 'Unit', type: 'rich' }] },
    ],
};

describe('findUnit', () => {
    it('finds unit by id', () => {
        expect(findUnit(structure, 'u1')?.name).toBe('Unit 101');
    });
    it('returns null for unknown id', () => {
        expect(findUnit(structure, 'xxx')).toBeNull();
    });
    it('returns null for undefined structure', () => {
        expect(findUnit(undefined, 'u1')).toBeNull();
    });
});

describe('findBuildingOfUnit', () => {
    it('finds building containing unit', () => {
        expect(findBuildingOfUnit(structure, 'u1')?.name).toBe('Building A');
        expect(findBuildingOfUnit(structure, 'u3')?.name).toBe('Building B');
    });
    it('returns null for unknown unit', () => {
        expect(findBuildingOfUnit(structure, 'xxx')).toBeNull();
    });
});

describe('resolveUnitSections', () => {
    it('returns all sections without overrides', () => {
        const result = resolveUnitSections(schema, 'u1');
        expect(result.map(s => s.id)).toEqual(['roof', 'elec', 'hvac']);
    });

    it('excludes sections from overrides', () => {
        const overrides = { u1: { sectionsExcluded: ['hvac'] } };
        const result = resolveUnitSections(schema, 'u1', overrides);
        expect(result.map(s => s.id)).toEqual(['roof', 'elec']);
    });

    it('includes additional sections from overrides', () => {
        const overrides = { u1: { sectionsIncluded: ['pool'] } };
        const result = resolveUnitSections(schema, 'u1', overrides);
        expect(result.map(s => s.id)).toEqual(['roof', 'elec', 'hvac']);
        // 'pool' not in schema, so filtered out
    });
});

describe('resolveUnitSectionItems', () => {
    it('returns all items without overrides', () => {
        const result = resolveUnitSectionItems(schema, 'u1', 'roof');
        expect(result).toEqual(['roof-1', 'roof-2']);
    });

    it('excludes items from overrides', () => {
        const overrides = { u1: { itemsExcluded: { roof: ['roof-2'] } } };
        const result = resolveUnitSectionItems(schema, 'u1', 'roof', overrides);
        expect(result).toEqual(['roof-1']);
    });

    it('returns empty for unknown section', () => {
        expect(resolveUnitSectionItems(schema, 'u1', 'xxx')).toEqual([]);
    });
});
