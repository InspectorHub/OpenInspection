/**
 * Collab edit permission, now decided from the ROSTER.
 *
 * It used to read `inspections.inspector_id`, `lead_inspector_id` and the
 * `helper_inspector_ids` JSON. The latter two were NULL and '[]' on every
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
import { ROLES } from '../../../server/lib/auth/roles';
import type { InspectionRoster } from '../../../server/lib/inspection/roster';

const member = (id: string) => ({ id, name: id, email: `${id}@example.com` });
const roster = (lead: string | null, helpers: string[] = []): InspectionRoster => ({
  lead: lead ? member(lead) : null,
  helpers: helpers.map(member),
});

const LED_BY_INSP = roster('u-insp');

describe('canAccessInspectionCollab', () => {
  /**
   * ⚠️ THE ROLE STRINGS HERE MUST BE REAL ONES.
   *
   * This suite used to assert that `role: 'admin'` was allowed, and it passed —
   * against a role this product does not have. `ROLES` is
   * `owner | manager | inspector | agent`, and the predicate's own set was
   * `{'admin', 'manager'}`: half of it matched nobody, and `owner` — the
   * highest role there is — fell through to the roster and was refused on every
   * inspection it was not personally assigned to.
   *
   * A spec that invents its vocabulary agrees with itself and with nothing else.
   * This case is the instrument check for the ones below it.
   */
  it('is written against roles that exist', () => {
    expect(ROLES).toContain('owner');
    expect(ROLES).toContain('manager');
    expect(ROLES).toContain('inspector');
    expect(ROLES).not.toContain('admin');
  });

  it('the owner, not assigned, is allowed', () =>
    expect(canAccessInspectionCollab(LED_BY_INSP, { id: 'u-owner', role: 'owner' })).toBe(true));

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
    expect(canAccessInspectionCollab(roster(null), { id: 'u-owner', role: 'owner' })).toBe(true);
  });

  /**
   * POSITIVE CONTROL for the two elevated cases: a role the product does not
   * issue must not be a way in. Before the fix this was the ONLY string that
   * opened the door, and no account could ever hold it.
   */
  it('a role this product does not issue grants nothing', () =>
    expect(canAccessInspectionCollab(LED_BY_INSP, { id: 'u-x', role: 'admin' })).toBe(false));

  it('a helper on ANOTHER inspection is denied', () => {
    // The roster is fetched per inspection, so membership is never global.
    expect(canAccessInspectionCollab(roster('u-lead', ['u-h']), { id: 'u-h2', role: 'inspector' })).toBe(false);
  });
});
