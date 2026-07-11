import { describe, it, expect } from 'vitest';
import type { ReportLoaderResult } from './types';

describe('ReportLoaderResult cost tables', () => {
  it('carries a nullable costTables field', () => {
    const sample: Pick<ReportLoaderResult, 'costTables'> = { costTables: null };
    expect(sample.costTables).toBeNull();
  });
});
