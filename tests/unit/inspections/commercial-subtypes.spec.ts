import { describe, it, expect } from 'vitest';
import { PLATFORM_SUBTYPES, METADATA_PRESETS, getSubtypeDef, getMetadataPreset, normalizePropertyType } from '../../../server/lib/commercial-subtypes';
import { sectionApplies, getApplicableSections } from '../../../server/lib/section-applicability';
import type { TemplateSection } from '../../../server/types/template-schema';

describe('PLATFORM_SUBTYPES', () => {
    it('has 6 entries', () => {
        expect(PLATFORM_SUBTYPES).toHaveLength(6);
    });

    it('all are locked', () => {
        for (const s of PLATFORM_SUBTYPES) {
            expect(s.locked).toBe(true);
        }
    });

    it('includes expected IDs', () => {
        const ids = PLATFORM_SUBTYPES.map(s => s.id);
        expect(ids).toContain('office');
        expect(ids).toContain('retail');
        expect(ids).toContain('hospitality');
        expect(ids).toContain('industrial');
        expect(ids).toContain('institutional');
        expect(ids).toContain('mixed-use');
    });
});

describe('METADATA_PRESETS', () => {
    it('has presets for all property types', () => {
        expect(METADATA_PRESETS['single-family']).toBeDefined();
        expect(METADATA_PRESETS['multi-unit']).toBeDefined();
        expect(METADATA_PRESETS['commercial:office']).toBeDefined();
        expect(METADATA_PRESETS['commercial:retail']).toBeDefined();
        expect(METADATA_PRESETS['commercial:hospitality']).toBeDefined();
        expect(METADATA_PRESETS['commercial:industrial']).toBeDefined();
        expect(METADATA_PRESETS['commercial:institutional']).toBeDefined();
        expect(METADATA_PRESETS['commercial:mixed-use']).toBeDefined();
    });

    it('single-family has yearBuilt as required', () => {
        const preset = METADATA_PRESETS['single-family'];
        const yb = preset.find(f => f.id === 'yearBuilt');
        expect(yb?.required).toBe(true);
    });
});

describe('getSubtypeDef', () => {
    it('returns platform subtype by ID', () => {
        expect(getSubtypeDef('office')?.label).toBe('Office');
    });

    it('returns null for unknown ID', () => {
        expect(getSubtypeDef('unknown')).toBeNull();
    });
});

describe('getMetadataPreset', () => {
    it('returns single-family preset', () => {
        const fields = getMetadataPreset('single-family');
        expect(fields.length).toBeGreaterThan(0);
        expect(fields.find(f => f.id === 'yearBuilt')).toBeDefined();
    });

    it('returns commercial subtype preset', () => {
        const fields = getMetadataPreset('commercial', 'office');
        expect(fields.find(f => f.id === 'nra')).toBeDefined();
    });

    it('falls back to empty for unknown type', () => {
        expect(getMetadataPreset('unknown')).toEqual([]);
    });

    // Phase T — the wizard stores underscore slugs (single_family, multi_unit)
    // but METADATA_PRESETS is keyed on hyphen slugs. Before normalization these
    // returned [] for EVERY residential/multi-unit inspection (Building Profile
    // dormant). getMetadataPreset must normalize internally so callers never
    // have to remember to hyphenate.
    it('returns single-family preset for the underscore wizard slug single_family', () => {
        const fields = getMetadataPreset('single_family');
        expect(fields.length).toBeGreaterThan(0);
        expect(fields.find(f => f.id === 'yearBuilt')).toBeDefined();
        expect(fields).toEqual(getMetadataPreset('single-family'));
    });

    it('returns multi-unit preset for the underscore wizard slug multi_unit', () => {
        const fields = getMetadataPreset('multi_unit');
        expect(fields.find(f => f.id === 'totalUnits')).toBeDefined();
        expect(fields).toEqual(getMetadataPreset('multi-unit'));
    });

    it('commercial + subtype lookup is unaffected by normalization (commercial has no underscore)', () => {
        const fields = getMetadataPreset('commercial', 'office');
        expect(fields.find(f => f.id === 'nra')).toBeDefined();
    });
});

describe('normalizePropertyType', () => {
    it('maps single_family -> single-family', () => {
        expect(normalizePropertyType('single_family')).toBe('single-family');
    });

    it('maps multi_unit -> multi-unit', () => {
        expect(normalizePropertyType('multi_unit')).toBe('multi-unit');
    });

    it('passes commercial through unchanged', () => {
        expect(normalizePropertyType('commercial')).toBe('commercial');
    });

    it('passes an already-hyphenated value through unchanged', () => {
        expect(normalizePropertyType('single-family')).toBe('single-family');
        expect(normalizePropertyType('multi-unit')).toBe('multi-unit');
    });

    it('maps null/undefined/empty to null', () => {
        expect(normalizePropertyType(null)).toBeNull();
        expect(normalizePropertyType(undefined)).toBeNull();
        expect(normalizePropertyType('')).toBeNull();
    });

    it('passes an unrecognized value through unchanged', () => {
        expect(normalizePropertyType('townhouse')).toBe('townhouse');
    });
});

describe('sectionApplies', () => {
    const makeSection = (applicableTo?: TemplateSection['applicableTo']): TemplateSection => ({
        id: 'test', title: 'Test', items: [],
        ...(applicableTo ? { applicableTo } : {}),
    });

    it('applies when no applicableTo filter', () => {
        expect(sectionApplies(makeSection(), 'single-family')).toBe(true);
    });

    it('applies when propertyType matches', () => {
        expect(sectionApplies(
            makeSection({ propertyTypes: ['single-family', 'multi-unit'] }),
            'single-family',
        )).toBe(true);
    });

    it('does not apply when propertyType excluded', () => {
        expect(sectionApplies(
            makeSection({ propertyTypes: ['commercial'] }),
            'single-family',
        )).toBe(false);
    });

    it('applies to all commercial when no subtypes filter', () => {
        expect(sectionApplies(
            makeSection({ propertyTypes: ['commercial'] }),
            'commercial', 'retail',
        )).toBe(true);
    });

    it('applies when commercial subtype matches', () => {
        expect(sectionApplies(
            makeSection({ propertyTypes: ['commercial'], commercialSubtypes: ['retail', 'hospitality'] }),
            'commercial', 'retail',
        )).toBe(true);
    });

    it('does not apply when commercial subtype excluded', () => {
        expect(sectionApplies(
            makeSection({ propertyTypes: ['commercial'], commercialSubtypes: ['retail'] }),
            'commercial', 'office',
        )).toBe(false);
    });

    it('applies when org subtype basedOn matches a listed platform subtype', () => {
        // An org subtype "custom-retail" is based on platform subtype "retail".
        // The section allows "retail" — so it should apply via basedOn inheritance.
        expect(sectionApplies(
            makeSection({ propertyTypes: ['commercial'], commercialSubtypes: ['retail', 'hospitality'] }),
            'commercial', 'custom-retail', 'retail',
        )).toBe(true);
    });

    it('does not apply when neither subtypeId nor basedOn matches', () => {
        expect(sectionApplies(
            makeSection({ propertyTypes: ['commercial'], commercialSubtypes: ['retail'] }),
            'commercial', 'custom-office', 'office',
        )).toBe(false);
    });
});

describe('getApplicableSections', () => {
    const sections: TemplateSection[] = [
        { id: 'roof', title: 'Roof', items: [], applicableTo: { propertyTypes: ['single-family', 'multi-unit', 'commercial'] } },
        { id: 'garage', title: 'Garage', items: [], applicableTo: { propertyTypes: ['single-family'] } },
        { id: 'loading', title: 'Loading', items: [], applicableTo: { propertyTypes: ['commercial'], commercialSubtypes: ['industrial', 'retail'] } },
    ];

    it('filters for single-family', () => {
        const result = getApplicableSections(sections, 'single-family');
        expect(result.map(s => s.id)).toEqual(['roof', 'garage']);
    });

    it('filters for commercial:retail', () => {
        const result = getApplicableSections(sections, 'commercial', 'retail');
        expect(result.map(s => s.id)).toEqual(['roof', 'loading']);
    });
});
