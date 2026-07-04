import { describe, it, expect } from 'vitest';
import { resolveBuildingProfile } from '../../../server/lib/building-profile';

describe('resolveBuildingProfile', () => {
  it('returns [] when propertyType is null', () => {
    expect(resolveBuildingProfile({ propertyType: null })).toEqual([]);
  });

  it('returns [] for a propertyType with no matching preset', () => {
    expect(resolveBuildingProfile({ propertyType: 'single_family', propertyFacts: { yearBuilt: 1975 } })).toEqual([]);
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
