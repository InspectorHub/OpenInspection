import { describe, it, expect } from 'vitest';
import { canAccessInspectionCollab } from '../../../server/lib/collab/can-access';

const base = { inspectorId: 'u-insp', leadInspectorId: null, helperInspectorIds: '[]' };

describe('canAccessInspectionCollab', () => {
  it('admin not assigned is allowed', () =>
    expect(canAccessInspectionCollab(base, { id: 'u-admin', role: 'admin' })).toBe(true));
  it('manager not assigned is allowed', () =>
    expect(canAccessInspectionCollab(base, { id: 'u-mgr', role: 'manager' })).toBe(true));
  it('assigned inspector allowed', () =>
    expect(canAccessInspectionCollab(base, { id: 'u-insp', role: 'inspector' })).toBe(true));
  it('lead inspector allowed', () =>
    expect(canAccessInspectionCollab({ ...base, leadInspectorId: 'u-lead' }, { id: 'u-lead', role: 'inspector' })).toBe(true));
  it('unassigned inspector denied', () =>
    expect(canAccessInspectionCollab(base, { id: 'u-other', role: 'inspector' })).toBe(false));
  it('helper allowed', () =>
    expect(canAccessInspectionCollab({ ...base, helperInspectorIds: '["u-h"]' }, { id: 'u-h', role: 'inspector' })).toBe(true));
  it('malformed helpers JSON = no helpers', () =>
    expect(canAccessInspectionCollab({ ...base, helperInspectorIds: 'not-json' }, { id: 'u-other', role: 'inspector' })).toBe(false));
  it('null helpers = no helpers', () =>
    expect(canAccessInspectionCollab({ ...base, helperInspectorIds: null }, { id: 'u-other', role: 'inspector' })).toBe(false));
});
