import { describe, it, expect } from 'vitest';
import { reportActions } from '~/routes/inspection-hub';

const publishCaps = { publish: true };
const noCaps = { publish: false };

describe('reportActions', () => {
  it('non-completed → []', () => {
    expect(reportActions(publishCaps, 'in_progress', 'requested')).toEqual([]);
    expect(reportActions(publishCaps, 'in_progress', 'scheduled')).toEqual([]);
    expect(reportActions(publishCaps, 'in_progress', 'cancelled')).toEqual([]);
  });

  it('completed + published + publish cap → unpublish', () => {
    expect(reportActions(publishCaps, 'published', 'completed')).toEqual(['unpublish']);
  });

  it('completed + published + no cap → []', () => {
    expect(reportActions(noCaps, 'published', 'completed')).toEqual([]);
  });

  it('completed + submitted + publish cap → publish, return', () => {
    expect(reportActions(publishCaps, 'submitted', 'completed')).toEqual(['publish', 'return']);
  });

  it('completed + submitted + no cap → []', () => {
    expect(reportActions(noCaps, 'submitted', 'completed')).toEqual([]);
  });

  it('completed + in_progress + publish cap → publish', () => {
    expect(reportActions(publishCaps, 'in_progress', 'completed')).toEqual(['publish']);
  });

  it('completed + in_progress + no cap → submit', () => {
    expect(reportActions(noCaps, 'in_progress', 'completed')).toEqual(['submit']);
  });
});
