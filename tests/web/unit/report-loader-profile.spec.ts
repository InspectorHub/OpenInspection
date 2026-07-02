import { describe, it, expect } from 'vitest';
import type { ReportLoaderResult } from '~/components/portal/sections/report/types';

describe('ReportLoaderResult building profile', () => {
  it('carries propertyType, commercialSubtype, buildingProfile', () => {
    const sample: Pick<ReportLoaderResult, 'propertyType' | 'commercialSubtype' | 'buildingProfile'> = {
      propertyType: 'commercial',
      commercialSubtype: 'office',
      buildingProfile: [{ id: 'nra', group: 'physical', label: 'Net rentable area', value: 120000, unit: 'sqft' }],
    };
    expect(sample.buildingProfile[0].id).toBe('nra');
  });
});
