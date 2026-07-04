import { describe, it, expect } from 'vitest';
import { groupByInspectionStatus } from '~/routes/inspections';

// TODO(tests-reorg): stale since #147 (288da4a0) — this spec was added alongside the
// status-split PR but `groupByInspectionStatus` was never implemented as an exported
// pure helper on app/routes/inspections.tsx. The grouped-bucket view that shipped
// computes its groups inline (`filteredBuckets` useMemo, keyed off the `buckets` prop)
// instead of via a standalone function with this name/shape. This file was never wired
// into vitest.config.ts's include list (orphaned in tests/web/, never run) until the
// tests-reorg co-location pass activated it, surfacing the drift. Re-enable by either
// extracting the real grouping logic into an exported `groupByInspectionStatus` (and
// updating this spec to match its actual signature/behavior) or delete this spec if the
// coverage is superseded by the bucket-mode render tests.
describe.skip('groupByInspectionStatus', () => {
  it('groups rows by status in canonical order', () => {
    const rows = [
      { id: '1', status: 'completed' },
      { id: '2', status: 'requested' },
      { id: '3', status: 'completed' },
      { id: '4', status: 'scheduled' },
    ];
    const groups = groupByInspectionStatus(rows);
    // canonical order: requested, scheduled, confirmed, completed, cancelled
    expect(groups.map(g => g.status)).toEqual(['requested', 'scheduled', 'completed']);
    expect(groups.find(g => g.status === 'requested')?.items).toHaveLength(1);
    expect(groups.find(g => g.status === 'completed')?.items).toHaveLength(2);
  });

  it('excludes empty buckets', () => {
    const rows = [{ id: '1', status: 'cancelled' }];
    const groups = groupByInspectionStatus(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].status).toBe('cancelled');
  });

  it('uses INSPECTION_STATUS_LABELS for label', () => {
    const rows = [{ id: '1', status: 'confirmed' }];
    const groups = groupByInspectionStatus(rows);
    expect(groups[0].label).toBe('Confirmed');
  });

  it('returns empty array when no rows', () => {
    expect(groupByInspectionStatus([])).toEqual([]);
  });

  it('drops unknown statuses', () => {
    const rows = [
      { id: '1', status: 'completed' },
      { id: '2', status: 'unknown_status' },
    ];
    const groups = groupByInspectionStatus(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].status).toBe('completed');
  });
});
