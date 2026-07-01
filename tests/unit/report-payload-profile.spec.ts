// tests/unit/report-payload-profile.spec.ts
import { describe, it, expect } from 'vitest';
import { resolveBuildingProfile } from '../../server/lib/building-profile';

describe('report payload building profile shaping', () => {
  it('builds buildingProfile from an inspection-shaped row', () => {
    const inspection = {
      propertyType: 'commercial',
      commercialSubtype: 'retail',
      propertyFacts: { yearBuilt: 2005, gla: 45000, anchorTenant: 'Target' },
      yearBuilt: null, sqft: null, foundationType: null, lotSize: null, bedrooms: null, bathrooms: null,
    };
    const buildingProfile = resolveBuildingProfile(inspection);
    expect(buildingProfile.map((r) => r.id)).toEqual(['yearBuilt', 'gla', 'anchorTenant']);
    expect(buildingProfile.find((r) => r.id === 'gla')).toMatchObject({ value: 45000, unit: 'sqft', group: 'physical' });
  });
});
