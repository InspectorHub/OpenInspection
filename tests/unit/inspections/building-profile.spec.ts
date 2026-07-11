import { describe, it, expect } from 'vitest';
import { resolveBuildingProfile } from '../../../server/lib/building-profile';

describe('resolveBuildingProfile', () => {
  it('returns [] when propertyType is null', () => {
    expect(resolveBuildingProfile({ propertyType: null })).toEqual([]);
  });

  it('returns [] for a propertyType with no matching preset', () => {
    expect(resolveBuildingProfile({ propertyType: 'townhouse', propertyFacts: { yearBuilt: 1975 } })).toEqual([]);
  });

  // Phase T root-cause fix — inspections store the underscore wizard slug
  // (single_family/multi_unit), but METADATA_PRESETS is hyphen-keyed. Before
  // normalizePropertyType was wired into getMetadataPreset, this returned []
  // for EVERY residential/multi-unit inspection (Building Profile dormant).
  it('resolves single-family rows for the underscore wizard slug single_family (was [])', () => {
    const rows = resolveBuildingProfile({ propertyType: 'single_family', yearBuilt: 1975, sqft: 2100 });
    expect(rows).not.toEqual([]);
    expect(rows.find((r) => r.id === 'yearBuilt')?.value).toBe(1975);
    expect(rows.find((r) => r.id === 'sqft')?.value).toBe(2100);
  });

  it('resolves multi-unit rows for the underscore wizard slug multi_unit (was [])', () => {
    const rows = resolveBuildingProfile({
      propertyType: 'multi_unit',
      propertyFacts: { yearBuilt: 1988, totalUnits: 12 },
    });
    expect(rows).not.toEqual([]);
    expect(rows.find((r) => r.id === 'totalUnits')?.value).toBe(12);
  });

  it('resolves commercial office rows from propertyFacts, ordered by preset, null values dropped', () => {
    const rows = resolveBuildingProfile({
      propertyType: 'commercial',
      commercialSubtype: 'office',
      propertyFacts: { yearBuilt: 1998, nra: 120000, floorCount: 6 }, // occupancyClass/sprinklered/lastRenovation absent
    });
    expect(rows).toEqual([
      { id: 'yearBuilt', group: 'identity', label: 'Year built', value: 1998, unit: null },
      { id: 'nra', group: 'physical', label: 'Net rentable area', value: 120000, unit: 'sqft' },
      { id: 'floorCount', group: 'physical', label: 'Number of floors', value: 6, unit: null },
    ]);
  });

  it('treats empty string as absent', () => {
    const rows = resolveBuildingProfile({
      propertyType: 'commercial', commercialSubtype: 'office',
      propertyFacts: { yearBuilt: 1998, occupancyClass: '' },
    });
    expect(rows.some((r) => r.id === 'occupancyClass')).toBe(false);
    expect(rows.map((r) => r.id)).toEqual(['yearBuilt']);
  });

  it('falls back to the dedicated residential columns for a matching residential preset key', () => {
    const rows = resolveBuildingProfile({
      propertyType: 'single-family', // METADATA_PRESETS key (hyphen)
      propertyFacts: null,
      yearBuilt: 1975, sqft: 2100,
    });
    expect(rows.find((r) => r.id === 'yearBuilt')?.value).toBe(1975);
    expect(rows.find((r) => r.id === 'sqft')?.value).toBe(2100);
  });
});
