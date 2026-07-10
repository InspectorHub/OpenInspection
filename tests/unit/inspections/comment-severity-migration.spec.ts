import { describe, it, expect } from 'vitest';
import { mapRatingSystemLevels } from '../../../server/lib/map-rating-levels';

describe('canonical severity mapping', () => {
  it('reads severity directly from canonical levels (no bucket)', () => {
    const mapped = mapRatingSystemLevels([
      { abbreviation: 'D', label: 'Defect', color: '#ef4444', severity: 'significant', isDefect: true, pausesAdvance: true, order: 1 },
      { abbreviation: 'S', label: 'Satisfactory', color: '#22c55e', severity: 'good', isDefect: false, order: 0 },
    ]);
    expect(mapped[0].label).toBe('Satisfactory'); // sorted by order
    expect(mapped[1].severity).toBe('significant');
    expect(mapped[1].isDefect).toBe(true);
    expect(mapped[1].pausesAdvance).toBe(true);
    expect(mapped[1].abbreviation).toBe('D');
  });
});
