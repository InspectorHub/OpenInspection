// Verifies the report summary cards are derived DYNAMICALLY from the
// inspection's own rating system (Spectora-style), not the previous hardcoded
// "Satisfactory / Monitor / Defects" buckets. Raw-source assertions mirror the
// existing report-card-stack web tests.
import { describe, it, expect } from 'vitest';

describe('report-card-stack dynamic rating summary', () => {
  it('tallies items by their rating level and renders per-level cards', async () => {
    const src = ((await import('~/components/portal/sections/ReportView?raw')) as { default: string }).default;
    // Dynamic per-level tally using each item's own rating label/color.
    expect(src).toContain('ratingTally');
    expect(src).toContain('summaryCards');
    expect(src).toContain('it.ratingLabel');
    expect(src).toContain('it.ratingColor');
    // The old hardcoded bucket cards must be gone — reverting reintroduces these.
    expect(src).not.toContain('data.stats.satisfactory');
    expect(src).not.toContain('data.stats.monitor');
    expect(src).not.toContain('data.stats.defect');
  });
});
