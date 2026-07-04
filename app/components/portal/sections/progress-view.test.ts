import { describe, it, expect } from 'vitest';
import { progressBars } from '../../../../app/components/portal/sections/ProgressView';

describe('ProgressView progressBars', () => {
  it('computes per-section completion %', () => {
    const bars = progressBars([{ name: 'Roof', completedItems: 5, totalItems: 10 }]);
    expect(bars[0].pct).toBe(50);
  });
  it('clamps zero-total to 0%', () => {
    expect(progressBars([{ name: 'X', completedItems: 0, totalItems: 0 }])[0].pct).toBe(0);
  });
});
