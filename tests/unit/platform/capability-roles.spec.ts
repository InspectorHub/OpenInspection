/**
 * The default capability table for all five roles, and the `editReports`
 * capability. The table below is the authority: the assertions read it, they do
 * not restate the values one role at a time.
 *
 * `P` marks a value that is pinned (an override cannot change it).
 */
import { describe, it, expect } from 'vitest';
import { getCapabilities, pinnedCapabilities, TOGGLEABLE, type Capability } from '../../../server/lib/auth/capabilities';
import { ROLES, type Role } from '../../../server/lib/auth/roles';

type Cell = { v: boolean; pinned: boolean };
const T = { v: true, pinned: false }, F = { v: false, pinned: false };
const TP = { v: true, pinned: true }, FP = { v: false, pinned: true };

const TABLE: Record<Capability, Record<Role, Cell>> = {
  //                    owner manager inspector staff agent
  publish:           { owner: TP, manager: T, inspector: T, staff: T, agent: FP },
  scheduleOthers:    { owner: TP, manager: T, inspector: F, staff: T, agent: FP },
  inspectionFees:    { owner: TP, manager: T, inspector: T, staff: T, agent: FP },
  companyFinance:    { owner: TP, manager: T, inspector: F, staff: F, agent: FP },
  manageContacts:    { owner: TP, manager: T, inspector: F, staff: T, agent: FP },
  viewCommunication: { owner: TP, manager: T, inspector: T, staff: T, agent: FP },
  templateCreate:    { owner: TP, manager: T, inspector: T, staff: F, agent: FP },
  templateEdit:      { owner: TP, manager: T, inspector: T, staff: F, agent: FP },
  templateDelete:    { owner: TP, manager: T, inspector: F, staff: F, agent: FP },
  templateImport:    { owner: TP, manager: T, inspector: T, staff: F, agent: FP },
  deleteInspection:  { owner: TP, manager: T, inspector: T, staff: F, agent: FP },
  editReports:       { owner: TP, manager: T, inspector: T, staff: F, agent: FP },
};

describe('capability table', () => {
  it('has a row for every capability and a column for every role, and prints both counts', () => {
    // eslint-disable-next-line no-console
    console.log(`[gate] capability-table rows=${Object.keys(TABLE).length} capabilities=${TOGGLEABLE.length} roles=${ROLES.length}`);
    expect(Object.keys(TABLE).sort()).toEqual([...TOGGLEABLE].sort());
    for (const cap of TOGGLEABLE) expect(Object.keys(TABLE[cap]).sort()).toEqual([...ROLES].sort());
    expect(TOGGLEABLE).toContain('editReports');
  });

  const cells = ROLES.flatMap((role) => TOGGLEABLE.map((cap) => [role, cap, TABLE[cap][role]] as const));

  it.each(cells.map(([role, cap, cell]) => [role, cap, cell.v] as const))(
    'default %s / %s = %s',
    (role, cap, expected) => {
      expect(getCapabilities(role, null)[cap]).toBe(expected);
    },
  );

  it.each(cells.filter(([, , c]) => c.pinned).map(([role, cap, c]) => [role, cap, c.v] as const))(
    '%s / %s stays %s under an override that says the opposite',
    (role, cap, pinnedValue) => {
      expect(getCapabilities(role, { [cap]: !pinnedValue })[cap]).toBe(pinnedValue);
    },
  );

  it.each(cells.filter(([, , c]) => !c.pinned).map(([role, cap, c]) => [role, cap, c.v] as const))(
    '%s / %s can be overridden to the opposite (negative control for the pins)',
    (role, cap, dflt) => {
      expect(getCapabilities(role, { [cap]: !dflt })[cap]).toBe(!dflt);
    },
  );
});

describe('editReports', () => {
  it('an agent never holds any capability, whatever the override sheet says', () => {
    const all = Object.fromEntries(TOGGLEABLE.map((c) => [c, true]));
    const caps = getCapabilities('agent', all);
    expect(TOGGLEABLE.filter((c) => caps[c])).toEqual([]);
  });

  it('staff default to no, and the owner can switch it on', () => {
    expect(getCapabilities('staff', null).editReports).toBe(false);
    expect(getCapabilities('staff', { editReports: true }).editReports).toBe(true);
  });

  it('an inspector can have it withdrawn; the owner cannot', () => {
    expect(getCapabilities('inspector', { editReports: false }).editReports).toBe(false);
    expect(getCapabilities('owner', { editReports: false }).editReports).toBe(true);
  });
});

describe('pinnedCapabilities', () => {
  it('lists exactly the cells the table marks as pinned, for every role', () => {
    for (const role of ROLES) {
      const expected = TOGGLEABLE.filter((cap) => TABLE[cap][role].pinned);
      expect([...pinnedCapabilities(role)].sort()).toEqual([...expected].sort());
    }
  });

  it('leaves the roles a company configures per person with nothing pinned', () => {
    expect(pinnedCapabilities('inspector')).toEqual([]);
    expect(pinnedCapabilities('staff')).toEqual([]);
    expect(pinnedCapabilities('manager')).toEqual([]);
  });
});
