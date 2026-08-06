// Verifies the report summary cards are derived DYNAMICALLY from the
// inspection's own rating system (Spectora-style), not the previous hardcoded
// "Satisfactory / Monitor / Defects" buckets. Raw-source assertions mirror the
// existing report-card-stack web tests.
//
// The tally + card row now live in the co-located <ReportSummaryStats> (the
// derivation moved with its render). Both modules are concatenated so the
// positive markers are found and — more importantly — the negative assertions
// cover the whole surface rather than only the file the block used to be in.
import { describe, it, expect } from 'vitest';

async function source(): Promise<string> {
  const mods = await Promise.all([
    import('~/components/portal/sections/ReportView?raw'),
    import('~/components/portal/sections/report/ReportSummaryStats?raw'),
  ]);
  return mods.map((m) => (m as unknown as { default: string }).default).join('\n');
}

describe('report-card-stack dynamic rating summary', () => {
  it('tallies items by their rating level and renders per-level cards', async () => {
    const src = await source();
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
