import { describe, it, expect } from 'vitest';
import type { ReportLoaderResult } from './types';

describe('ReportLoaderResult report tier', () => {
  it('carries reportTier', () => {
    const sample: Pick<ReportLoaderResult, 'reportTier'> = { reportTier: 'full_pca' };
    expect(sample.reportTier).toBe('full_pca');
  });
  it('allows null for residential', () => {
    const sample: Pick<ReportLoaderResult, 'reportTier'> = { reportTier: null };
    expect(sample.reportTier).toBeNull();
  });
});
