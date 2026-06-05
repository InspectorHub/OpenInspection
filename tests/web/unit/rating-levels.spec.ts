import { describe, it, expect } from 'vitest';
import { findRatingLevel, ratingAdvanceDecision } from '~/lib/rating-levels';

/**
 * B-18 — the editor looked ratings up via `levels.find(l => l.id === rating)`
 * while ItemEditor emitted hardcoded 'DEF'/'SAT' ids and the rating-system
 * levels carry ids like 'Defect'. The lookup always missed, so the seeds'
 * `pausesAdvance: true` on Defect/Monitor never fired and the editor
 * auto-advanced away from the item the inspector was about to describe.
 */
describe('findRatingLevel', () => {
  const levels = [
    { id: 'Satisfactory', label: 'Satisfactory', abbreviation: 'Sat' },
    { id: 'Monitor', label: 'Monitor', abbreviation: 'Mon', pausesAdvance: true },
    { id: 'Defect', label: 'Defect', abbreviation: 'D', pausesAdvance: true },
    { id: 'Not Inspected', label: 'Not Inspected', abbreviation: 'NI' },
  ];

  it('matches by exact id', () => {
    expect(findRatingLevel(levels, 'Defect')?.id).toBe('Defect');
  });

  it('matches case-insensitively on id', () => {
    expect(findRatingLevel(levels, 'defect')?.id).toBe('Defect');
  });

  it('matches by abbreviation (legacy stored values like "DEF" map onto "D"-style abbrs)', () => {
    expect(findRatingLevel(levels, 'Sat')?.id).toBe('Satisfactory');
    expect(findRatingLevel(levels, 'NI')?.id).toBe('Not Inspected');
  });

  it('matches legacy hardcoded ItemEditor ids against labels', () => {
    // Old mouse-path writes stored 'DEF'/'MON'/'SAT'; the levels carry
    // full-word ids. Prefix matching on the label keeps those rows lit.
    expect(findRatingLevel(levels, 'DEF')?.id).toBe('Defect');
    expect(findRatingLevel(levels, 'MON')?.id).toBe('Monitor');
    expect(findRatingLevel(levels, 'SAT')?.id).toBe('Satisfactory');
  });

  it('returns undefined for empty/unknown values', () => {
    expect(findRatingLevel(levels, '')).toBeUndefined();
    expect(findRatingLevel(levels, null)).toBeUndefined();
    expect(findRatingLevel(levels, 'XYZ')).toBeUndefined();
  });
});

describe('ratingAdvanceDecision', () => {
  const plain = { id: 'Satisfactory' };
  const pausing = { id: 'Defect', pausesAdvance: true };

  it('pausing levels never advance and focus notes (rate → describe flow)', () => {
    expect(ratingAdvanceDecision({ source: 'keyboard', level: pausing, mode: 'always' }))
      .toEqual({ advance: false, focusNotes: true });
    expect(ratingAdvanceDecision({ source: 'pointer', level: pausing, mode: 'keyboard' }))
      .toEqual({ advance: false, focusNotes: true });
  });

  it("default 'keyboard' mode: keyboard rating advances, pointer click stays put", () => {
    expect(ratingAdvanceDecision({ source: 'keyboard', level: plain, mode: 'keyboard' }).advance).toBe(true);
    expect(ratingAdvanceDecision({ source: 'pointer', level: plain, mode: 'keyboard' }).advance).toBe(false);
  });

  it("'always' mode advances for both sources on non-pausing levels", () => {
    expect(ratingAdvanceDecision({ source: 'pointer', level: plain, mode: 'always' }).advance).toBe(true);
    expect(ratingAdvanceDecision({ source: 'keyboard', level: plain, mode: 'always' }).advance).toBe(true);
  });

  it("'off' mode never advances", () => {
    expect(ratingAdvanceDecision({ source: 'keyboard', level: plain, mode: 'off' }).advance).toBe(false);
    expect(ratingAdvanceDecision({ source: 'pointer', level: plain, mode: 'off' }).advance).toBe(false);
  });

  it('unknown level (lookup miss) behaves like a plain level, not a crash', () => {
    const d = ratingAdvanceDecision({ source: 'keyboard', level: undefined, mode: 'keyboard' });
    expect(d).toEqual({ advance: true, focusNotes: false });
  });
});
