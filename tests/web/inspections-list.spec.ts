import { describe, it, expect } from 'vitest';
import { groupByInspectionStatus } from '~/routes/inspections';

describe('groupByInspectionStatus', () => {
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
