import { describe, it, expect } from 'vitest';
import { findRatingContradictions } from '~/lib/contradiction-lint';

/**
 * C-14b — the standard template pre-checks an Information narrative reading
 * "Roof covering appears serviceable with no visible defects…" while the
 * inspector rates the same item Defect. Both land in the published report,
 * contradicting each other. The lint surfaces included info/limitation
 * entries whose prose claims "no defects" when the rating says otherwise.
 */
describe('findRatingContradictions', () => {
  const entries = [
    { id: 'mat', title: 'Material', comment: 'Asphalt composition shingles observed.' },
    { id: 'cond', title: 'Condition', comment: 'Roof covering appears serviceable with no visible defects at the time of inspection.' },
    { id: 'life', title: 'Service Life', comment: 'Estimated remaining service life of approximately 10 years.' },
  ];

  it('flags an included "no visible defects" narrative when the rating is a defect', () => {
    const hits = findRatingContradictions({
      level: { id: 'Defect', isDefect: true },
      entries,
      includedIds: new Set(['mat', 'cond']),
    });
    expect(hits.map((h) => h.id)).toEqual(['cond']);
  });

  it('flags for Monitor (marginal severity) too', () => {
    const hits = findRatingContradictions({
      level: { id: 'Monitor', severity: 'marginal' },
      entries,
      includedIds: new Set(['cond']),
    });
    expect(hits).toHaveLength(1);
  });

  it('does not flag when the contradicting entry is not included', () => {
    const hits = findRatingContradictions({
      level: { id: 'Defect', isDefect: true },
      entries,
      includedIds: new Set(['mat', 'life']),
    });
    expect(hits).toHaveLength(0);
  });

  it('does not flag on satisfactory / NA ratings', () => {
    expect(findRatingContradictions({
      level: { id: 'Satisfactory', severity: 'good' },
      entries,
      includedIds: new Set(['cond']),
    })).toHaveLength(0);
    expect(findRatingContradictions({
      level: undefined,
      entries,
      includedIds: new Set(['cond']),
    })).toHaveLength(0);
  });

  it('matches other "all clear" phrasings', () => {
    const optimistic = [
      { id: 'a', title: 'Condition', comment: 'Unit appears to be in good condition.' },
      { id: 'b', title: 'Status', comment: 'No defects were observed during the inspection.' },
    ];
    const hits = findRatingContradictions({
      level: { id: 'Defect', isDefect: true },
      entries: optimistic,
      includedIds: new Set(['a', 'b']),
    });
    expect(hits.map((h) => h.id)).toEqual(['a', 'b']);
  });
});
