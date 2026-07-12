// tests/unit/reports/report-outline.spec.ts
// Commercial PCA Phase O — buildReportOutline pure projection over the REAL
// Phase S registry shape (server/lib/pca-section-registry.ts): PcaSectionEntry
// has `level: number` (0 = front-matter, 1 = chapter, 2 = subsection) and a
// `tiers` array — NOT the plan's assumed `{ id, level: 1 | 2, title }`.
import { describe, it, expect } from 'vitest';
import { buildReportOutline } from '../../../server/lib/report-outline';
import type { PcaSectionEntry } from '../../../server/lib/pca-section-registry';

const BOTH: PcaSectionEntry['tiers'] = ['light', 'full'];
const FULL: PcaSectionEntry['tiers'] = ['full'];

const reg: PcaSectionEntry[] = [
  { id: 'cover', level: 0, title: 'Cover', tiers: BOTH },
  { id: 'transmittal-letter', level: 0, title: 'Transmittal Letter', tiers: FULL },
  { id: 'toc', level: 0, title: 'Table of Contents', tiers: BOTH },
  { id: 'summary', level: 1, title: 'Summary', tiers: BOTH },
  { id: 'summary.general-description', level: 2, title: 'General Description', tiers: BOTH },
  { id: 'site', level: 1, title: 'Site', tiers: BOTH },
];

describe('buildReportOutline', () => {
  it('projects registry to outline entries in order, preserving level, page undefined', () => {
    const out = buildReportOutline(reg);
    expect(out.map((e) => e.id)).toEqual([
      'transmittal-letter', 'summary', 'summary.general-description', 'site',
    ]);
    expect(out.map((e) => e.level)).toEqual([0, 1, 2, 1]);
    expect(out.every((e) => e.page === undefined)).toBe(true);
  });

  it('drops the self-referential cover and toc ids', () => {
    const out = buildReportOutline(reg);
    expect(out.some((e) => e.id === 'cover')).toBe(false);
    expect(out.some((e) => e.id === 'toc')).toBe(false);
  });

  it('preserves a level-2 subsection in order alongside its level-1 parent', () => {
    const out = buildReportOutline(reg);
    const summaryIdx = out.findIndex((e) => e.id === 'summary');
    const subIdx = out.findIndex((e) => e.id === 'summary.general-description');
    expect(summaryIdx).toBeGreaterThanOrEqual(0);
    expect(subIdx).toBe(summaryIdx + 1);
    expect(out[subIdx]?.level).toBe(2);
  });

  it('drops entries with blank id or title (defensive)', () => {
    const out = buildReportOutline([
      { id: '', level: 1, title: 'Orphan', tiers: BOTH },
      { id: 'ok', level: 1, title: '', tiers: BOTH },
      { id: 'good', level: 1, title: 'Good', tiers: BOTH },
    ]);
    expect(out.map((e) => e.id)).toEqual(['good']);
  });

  it('returns [] for an empty registry', () => {
    expect(buildReportOutline([])).toEqual([]);
  });
});
