import { describe, it, expect } from 'vitest';
import { computeReportStats, getRatingColor, getRatingBucket } from '../../src/lib/report-utils';

const defaultLevels = [
  { id: 'S', label: 'Satisfactory', abbreviation: 'SAT', color: '#22c55e', severity: 'good' as const, isDefect: false },
  { id: 'M', label: 'Monitor', abbreviation: 'MON', color: '#f59e0b', severity: 'marginal' as const, isDefect: false },
  { id: 'D', label: 'Defect', abbreviation: 'DEF', color: '#f43f5e', severity: 'significant' as const, isDefect: true },
  { id: 'NI', label: 'Not Inspected', abbreviation: 'NI', color: '#3b82f6', severity: 'minor' as const, isDefect: false },
];

describe('getRatingBucket', () => {
  it('maps good severity to satisfactory bucket', () => {
    expect(getRatingBucket('S', defaultLevels)).toBe('satisfactory');
  });
  it('maps marginal severity to monitor bucket', () => {
    expect(getRatingBucket('M', defaultLevels)).toBe('monitor');
  });
  it('maps significant severity to defect bucket', () => {
    expect(getRatingBucket('D', defaultLevels)).toBe('defect');
  });
  it('maps minor severity to other bucket', () => {
    expect(getRatingBucket('NI', defaultLevels)).toBe('other');
  });
  it('returns other for unknown rating id', () => {
    expect(getRatingBucket('UNKNOWN', defaultLevels)).toBe('other');
  });
  it('falls back to default 3-level when levels is empty', () => {
    expect(getRatingBucket('Satisfactory', [])).toBe('satisfactory');
    expect(getRatingBucket('Monitor', [])).toBe('monitor');
    expect(getRatingBucket('Defect', [])).toBe('defect');
    expect(getRatingBucket('Unknown', [])).toBe('other');
  });
});

describe('getRatingColor', () => {
  it('returns level color for known rating', () => {
    expect(getRatingColor('S', defaultLevels)).toBe('#22c55e');
  });
  it('returns gray for unknown rating', () => {
    expect(getRatingColor('UNKNOWN', defaultLevels)).toBe('#9ca3af');
  });
  it('returns gray for null/undefined rating', () => {
    expect(getRatingColor(null, defaultLevels)).toBe('#9ca3af');
  });
});

describe('computeReportStats', () => {
  const sections = [
    { id: 's1', title: 'Roof', items: [
      { id: 'i1', label: 'Covering' },
      { id: 'i2', label: 'Flashing' },
      { id: 'i3', label: 'Gutters' },
    ]},
    { id: 's2', title: 'Electrical', items: [
      { id: 'i4', label: 'Panel' },
    ]},
  ];
  const results: Record<string, { rating?: string }> = {
    i1: { rating: 'D' },
    i2: { rating: 'S' },
    i3: { rating: 'M' },
    i4: { rating: 'NI' },
  };

  it('computes correct totals', () => {
    const stats = computeReportStats(sections, results, defaultLevels);
    expect(stats.total).toBe(4);
    expect(stats.satisfactory).toBe(1);
    expect(stats.monitor).toBe(1);
    expect(stats.defect).toBe(1);
    expect(stats.other).toBe(1);
  });

  it('computes per-section defect counts', () => {
    const stats = computeReportStats(sections, results, defaultLevels);
    expect(stats.sectionDefects['s1']).toBe(1);
    expect(stats.sectionDefects['s2']).toBe(0);
  });

  it('counts unrated items in other bucket', () => {
    const stats = computeReportStats(sections, { i1: { rating: 'S' } }, defaultLevels);
    expect(stats.satisfactory).toBe(1);
    expect(stats.other).toBe(3);
  });

  it('computes completionPercent correctly', () => {
    const stats = computeReportStats(sections, results, defaultLevels);
    expect(stats.completionPercent).toBe(100);

    const partial = computeReportStats(sections, { i1: { rating: 'S' } }, defaultLevels);
    expect(partial.completionPercent).toBe(25);
  });

  it('handles legacy 3-level format (no ratingSystem)', () => {
    const legacyResults: Record<string, { rating?: string }> = {
      i1: { rating: 'Defect' },
      i2: { rating: 'Satisfactory' },
      i3: { rating: 'Monitor' },
      i4: {},
    };
    const stats = computeReportStats(sections, legacyResults, []);
    expect(stats.defect).toBe(1);
    expect(stats.satisfactory).toBe(1);
    expect(stats.monitor).toBe(1);
    expect(stats.other).toBe(1);
  });
});
