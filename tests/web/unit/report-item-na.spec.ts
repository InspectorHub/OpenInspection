import { describe, it, expect } from 'vitest';
import type { ReportItem } from '~/components/portal/sections/report/types';

describe('ReportItem NI fields', () => {
  it('carries naKind + notInspectedReason', () => {
    const item: Pick<ReportItem, 'naKind' | 'notInspectedReason'> = {
      naKind: 'not_inspected',
      notInspectedReason: 'Roof hatch locked; no safe access.',
    };
    expect(item.naKind).toBe('not_inspected');
    expect(item.notInspectedReason).toContain('locked');
  });
});
