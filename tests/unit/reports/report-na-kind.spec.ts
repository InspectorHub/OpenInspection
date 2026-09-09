import { describe, it, expect } from 'vitest';
import { getNaKind, type RatingLevel } from '../../../server/lib/report-utils';

const levels: RatingLevel[] = [
  { id: 'ni', label: 'Not Inspected', abbreviation: 'NI', color: '#94a3b8', severity: 'minor', isDefect: false },
  { id: 'np', label: 'Not Present',   abbreviation: 'NP', color: '#cbd5e1', severity: 'minor', isDefect: false },
  { id: 'g',  label: 'Good',          abbreviation: 'G',  color: '#22c55e', severity: 'good',  isDefect: false },
  { id: 'd',  label: 'Deficient',     abbreviation: 'D',  color: '#f43f5e', severity: 'significant', isDefect: true },
];

describe('getNaKind', () => {
  it('classifies NI as not_inspected and NP as not_present', () => {
    expect(getNaKind('ni', levels)).toBe('not_inspected');
    expect(getNaKind('np', levels)).toBe('not_present');
  });
  it('returns null for non-na levels (good / defect)', () => {
    expect(getNaKind('g', levels)).toBeNull();
    expect(getNaKind('d', levels)).toBeNull();
  });
  it('returns null for a missing rating or empty level set', () => {
    expect(getNaKind(null, levels)).toBeNull();
    expect(getNaKind('ni', [])).toBeNull();
    expect(getNaKind('unknown-id', levels)).toBeNull();
  });
  it('falls back to the label when the abbreviation is nonstandard', () => {
    const custom: RatingLevel[] = [
      { id: 'x', label: 'Not present on site', abbreviation: 'NPS', color: '#ccc', severity: 'minor', isDefect: false },
    ];
    expect(getNaKind('x', custom)).toBe('not_present');
  });

  /**
   * A LEVEL WITH NO ABBREVIATION IS A SHAPE A WORKSPACE CAN AUTHOR.
   *
   * This interface declares `abbreviation` required, and every fixture above
   * supplies one — which is why nothing here ever reached the crash. The
   * TEMPLATE schema is the surface that decides what can arrive, and there
   * `abbreviation` is `z.string().optional()` while `severity` is an enum that
   * includes `'minor'`. So `{ id, label, severity: 'minor', isDefect: false }`
   * validates, stores, and renders.
   *
   * It reaches this function unrepaired because `getReportData`'s last
   * resolution path assigns `schemaData.ratingSystem.levels` straight across
   * without `mapRatingSystemLevels` — the earlier paths normalise, that one
   * does not. Measured before this test was written: the call threw
   * "Cannot read properties of undefined (reading 'trim')".
   *
   * The cast mirrors what the validator permits, not a shape invented here.
   */
  it('does not throw on a minor level that carries no abbreviation', () => {
    const noAbbr = [
      { id: 'na', label: 'N/A', color: '#ccc', severity: 'minor', isDefect: false },
    ] as unknown as RatingLevel[];
    expect(() => getNaKind('na', noAbbr)).not.toThrow();
  });

  /**
   * And it must still answer, not merely survive. "N/A" names neither kind, so
   * the honest answer is null — the report then shows the level's own label and
   * claims no distinction it cannot support.
   */
  it('answers null for a label that names neither kind', () => {
    const noAbbr = [
      { id: 'na', label: 'N/A', color: '#ccc', severity: 'minor', isDefect: false },
    ] as unknown as RatingLevel[];
    expect(getNaKind('na', noAbbr)).toBeNull();
  });

  /**
   * POSITIVE CONTROL: a function that returned null for everything would pass
   * both cases above. The label fallback must still work without an
   * abbreviation — this is the "labelled Not Inspected, abbreviated nothing"
   * workspace, and it is the whole reason the fallback exists.
   */
  it('still reads the label when there is no abbreviation to prefer', () => {
    const noAbbr = [
      { id: 'x', label: 'Not Inspected', color: '#ccc', severity: 'minor', isDefect: false },
    ] as unknown as RatingLevel[];
    expect(getNaKind('x', noAbbr)).toBe('not_inspected');
  });
});
