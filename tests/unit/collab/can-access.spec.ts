/**
 * Collab edit permission, now decided from the ROSTER.
 *
 * It used to read `inspections.inspector_id`, `lead_inspector_id` and the
 * `helper_inspector_ids` JSON. The latter two are NULL and '[]' on every
 * production row, so the check was effectively "are you inspector_id" while
 * claiming to honour a lead and a helper list — and the first write of either
 * would have made who-may-EDIT disagree with every other answer to "who works
 * this inspection".
 *
 * The malformed-JSON and null-helpers cases that used to live here are gone
 * along with the column they guarded: a role now lives in a column of its own,
 * so there is no string left to fail to parse.
 */
import { describe, it, expect } from 'vitest';
import { canAccessInspectionCollab } from '../../../server/lib/collab/can-access';
import type { InspectionRoster } from '../../../server/lib/inspection/roster';

const member = (id: string) => ({ id, name: id, email: `${id}@example.com` });
const roster = (lead: string | null, helpers: string[] = []): InspectionRoster => ({
  lead: lead ? member(lead) : null,
  helpers: helpers.map(member),
});

const LED_BY_INSP = roster('u-insp');

describe('canAccessInspectionCollab', () => {
  it('admin not assigned is allowed', () =>
    expect(canAccessInspectionCollab(LED_BY_INSP, { id: 'u-admin', role: 'admin' })).toBe(true));

  it('manager not assigned is allowed', () =>
    expect(canAccessInspectionCollab(LED_BY_INSP, { id: 'u-mgr', role: 'manager' })).toBe(true));

  it('the lead is allowed', () =>
    expect(canAccessInspectionCollab(LED_BY_INSP, { id: 'u-insp', role: 'inspector' })).toBe(true));

  it('a helper is allowed', () =>
    expect(canAccessInspectionCollab(roster('u-lead', ['u-h']), { id: 'u-h', role: 'inspector' })).toBe(true));

  it('an unassigned inspector is denied', () =>
    expect(canAccessInspectionCollab(LED_BY_INSP, { id: 'u-other', role: 'inspector' })).toBe(false));

  it('an empty roster grants nobody outside the admin roles', () => {
    // Fails CLOSED. An inspection whose roster has not been written must not
    // become editable by whoever asks — the safe direction for an auth check.
    expect(canAccessInspectionCollab(roster(null), { id: 'u-insp', role: 'inspector' })).toBe(false);
    expect(canAccessInspectionCollab(roster(null), { id: 'u-admin', role: 'admin' })).toBe(true);
  });

  it('a helper on ANOTHER inspection is denied', () => {
    // The roster is fetched per inspection, so membership is never global.
    expect(canAccessInspectionCollab(roster('u-lead', ['u-h']), { id: 'u-h2', role: 'inspector' })).toBe(false);
  });
});
