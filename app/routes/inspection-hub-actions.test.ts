import { describe, it, expect } from 'vitest';
import { reportActions } from '~/routes/inspection-hub';

const publishCaps = { publish: true };
const noCaps = { publish: false };

describe('reportActions', () => {
  // The order lifecycle no longer gates report actions: the hub used to render
  // nothing at all until the inspection was marked completed, which no surface
  // could do, so the Report card was a dead end for every real inspection.
  it('offers publish from every point in the order lifecycle', () => {
    expect(reportActions(publishCaps, 'in_progress')).toEqual(['publish']);
  });

  it('published + publish cap → unpublish', () => {
    expect(reportActions(publishCaps, 'published')).toEqual(['unpublish']);
  });

  it('published + no cap → []', () => {
    expect(reportActions(noCaps, 'published')).toEqual([]);
  });

  it('submitted + publish cap → publish, return', () => {
    expect(reportActions(publishCaps, 'submitted')).toEqual(['publish', 'return']);
  });

  it('submitted + no cap → []', () => {
    expect(reportActions(noCaps, 'submitted')).toEqual([]);
  });

  it('in_progress + publish cap → publish', () => {
    expect(reportActions(publishCaps, 'in_progress')).toEqual(['publish']);
  });

  it('in_progress + no cap → submit', () => {
    expect(reportActions(noCaps, 'in_progress')).toEqual(['submit']);
  });
});
