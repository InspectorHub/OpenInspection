import { describe, it, expect } from 'vitest';
import { reportActions, shouldShowPublishGate } from '~/routes/inspector-portal';
import type { PublishBlockingDefect } from '@core/field-ui/shared/types';

const publishCaps = { publish: true, edit: true };
const noCaps = { publish: false, edit: true };
// Office staff: no publish, and no report editing either.
const officeCaps = { publish: false, edit: false };

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

  it('published + editing again + publish cap → publish, unpublish', () => {
    expect(reportActions(publishCaps, 'published', true)).toEqual(['publish', 'unpublish']);
  });

  it('published + editing again + no cap → []', () => {
    expect(reportActions(noCaps, 'published', true)).toEqual([]);
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

  it('in_progress + no publish cap → submit', () => {
    expect(reportActions(noCaps, 'in_progress')).toEqual(['submit']);
  });

  it('in_progress with neither publish nor report editing (office staff) → nothing to take', () => {
    expect(reportActions(officeCaps, 'in_progress')).toEqual([]);
  });
});

describe('shouldShowPublishGate', () => {
  // Review item 1 — the hub's Publish button runs the same readiness
  // endpoint the editor calls, on demand, and shows the editor's
  // PublishGateModal with the defect list instead of the publish dialog.
  // The verdict mirrors the editor's handlePublishClick.
  it('a failed check (null) falls through to the publish dialog', () => {
    expect(shouldShowPublishGate(null)).toBe(false);
  });

  it('ready with no warnings → the publish dialog', () => {
    expect(shouldShowPublishGate({ ready: true, blockingDefects: [], warningDefects: [] })).toBe(false);
  });

  it('ready with warnings → the gate (IA-7 "Publish anyway" path)', () => {
    const warning: PublishBlockingDefect = { sectionId: 's', sectionTitle: 'Roof', itemId: 'i', itemLabel: 'Roof', cannedId: 'c', cannedTitle: 'Missing shingles', missing: ['location'], unresolvedTokens: [] };
    expect(shouldShowPublishGate({ ready: true, blockingDefects: [], warningDefects: [warning] })).toBe(true);
  });

  it('not ready → the gate, even with no warnings', () => {
    const blocking: PublishBlockingDefect = { sectionId: 's', sectionTitle: 'Roof', itemId: 'i', itemLabel: 'Roof', cannedId: 'c', cannedTitle: 'Missing shingles', missing: ['trade'], unresolvedTokens: [] };
    expect(shouldShowPublishGate({ ready: false, blockingDefects: [blocking], warningDefects: [] })).toBe(true);
  });
});
