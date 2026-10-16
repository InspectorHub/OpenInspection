import { describe, it, expect } from 'vitest';
import { getCapabilities, TOGGLEABLE } from '../../../server/lib/auth/capabilities';

describe('getCapabilities', () => {
  it('inspector defaults: publish on, schedule self, no company finance, no contacts', () => {
    expect(getCapabilities('inspector', null)).toMatchObject({ publish: true, scheduleOthers: false, companyFinance: false, manageContacts: false });
  });
  it('manager defaults: all four on', () => {
    expect(getCapabilities('manager', null)).toMatchObject({ publish: true, scheduleOthers: true, companyFinance: true, manageContacts: true });
  });
  it('overrides win over role defaults', () => {
    const c = getCapabilities('inspector', { companyFinance: true, publish: false });
    expect(c.companyFinance).toBe(true); expect(c.publish).toBe(false);
  });
  it('owner is always fully capable, ignoring reducing overrides', () => {
    expect(getCapabilities('owner', { companyFinance: false }).companyFinance).toBe(true);
  });
  it('agent has none of the staff capabilities', () => {
    expect(getCapabilities('agent', null)).toMatchObject({ publish: false, scheduleOthers: false, companyFinance: false, manageContacts: false });
  });
});

describe('viewCommunication', () => {
    it('defaults on for owner, manager and inspector', () => {
        expect(getCapabilities('owner', null).viewCommunication).toBe(true);
        expect(getCapabilities('manager', null).viewCommunication).toBe(true);
        expect(getCapabilities('inspector', null).viewCommunication).toBe(true);
    });

    it('is pinned off for agent even when an override tries to grant it', () => {
        expect(getCapabilities('agent', { viewCommunication: true }).viewCommunication).toBe(false);
    });

    it('can be withdrawn from an inspector by override', () => {
        expect(getCapabilities('inspector', { viewCommunication: false }).viewCommunication).toBe(false);
    });

    it('cannot be withdrawn from an owner', () => {
        expect(getCapabilities('owner', { viewCommunication: false }).viewCommunication).toBe(true);
    });
});

/**
 * The two pinned columns, checked across EVERY capability rather than the one
 * or two anyone remembered to name.
 *
 * `FIXED` is what makes "owner is never reducible, agent is never elevated" a
 * guarantee instead of a default, and its own comment says the failure mode is
 * silent: "A capability MISSING from either map silently opts out of that
 * guarantee". The tests above pinned `viewCommunication` and nothing else, so
 * four template bits were pinned in code with nobody proving it — and a tenth
 * capability added tomorrow would inherit that silence.
 *
 * These iterate TOGGLEABLE, so a new capability is covered the moment it is
 * declared. That is the point: the guarantee has to be about the SET, not
 * about the members someone happened to list in a spec.
 *
 * Agent matters most. An outside referral agent holds a real login to the
 * workspace, and this ceiling is the only thing standing between an
 * over-generous override row and a stranger with a finance bit.
 */
describe('the pinned columns hold for every capability', () => {
    // A run that iterated nothing must not read as a pass. If TOGGLEABLE were
    // ever empty (or the import broke), every `for` below would vacuously
    // succeed and this file would go green while checking nothing at all.
    it('has capabilities to check', () => {
        // eslint-disable-next-line no-console
        console.log(`[gate] pinned-columns — ${TOGGLEABLE.length} capabilities checked against 2 pinned roles`);
        expect(TOGGLEABLE.length).toBeGreaterThan(0);
    });

    it('agent is never elevated, one capability at a time', () => {
        const granted = TOGGLEABLE.filter((cap) => getCapabilities('agent', { [cap]: true })[cap]);
        expect(granted, `an override elevated an agent: ${granted.join(', ')}`).toEqual([]);
    });

    it('agent is never elevated by an override that sets all of them at once', () => {
        const all = Object.fromEntries(TOGGLEABLE.map((cap) => [cap, true]));
        const result = getCapabilities('agent', all);
        const granted = TOGGLEABLE.filter((cap) => result[cap]);
        expect(granted, `a full override sheet elevated an agent: ${granted.join(', ')}`).toEqual([]);
    });

    it('owner is never reduced, one capability at a time', () => {
        const lost = TOGGLEABLE.filter((cap) => !getCapabilities('owner', { [cap]: false })[cap]);
        expect(lost, `an override reduced an owner: ${lost.join(', ')}`).toEqual([]);
    });

    it('owner is never reduced by an override that clears all of them at once', () => {
        const none = Object.fromEntries(TOGGLEABLE.map((cap) => [cap, false]));
        const result = getCapabilities('owner', none);
        const lost = TOGGLEABLE.filter((cap) => !result[cap]);
        expect(lost, `a full override sheet reduced an owner: ${lost.join(', ')}`).toEqual([]);
    });

    it('the roles that are NOT pinned still take their overrides', () => {
        // The negative control. If `getCapabilities` ignored overrides
        // entirely — a plausible way to break it — every assertion above would
        // still pass, because ignoring an override looks exactly like pinning
        // against it. This is the case that tells the two apart.
        const flipped = TOGGLEABLE.filter(
            (cap) => getCapabilities('inspector', { [cap]: true })[cap],
        );
        expect(flipped, 'an inspector took none of the granting overrides').toEqual([...TOGGLEABLE]);
    });
});

describe('deleteInspection', () => {
  it('defaults on for owner, manager and inspector, off for agent', () => {
    for (const r of ['owner', 'manager', 'inspector'] as const) expect(getCapabilities(r, null).deleteInspection).toBe(true);
    expect(getCapabilities('agent', null).deleteInspection).toBe(false);
  });
  it('can be turned off for manager and inspector, never on for agent, never off for owner', () => {
    expect(getCapabilities('manager', { deleteInspection: false }).deleteInspection).toBe(false);
    expect(getCapabilities('inspector', { deleteInspection: false }).deleteInspection).toBe(false);
    expect(getCapabilities('agent', { deleteInspection: true }).deleteInspection).toBe(false);
    expect(getCapabilities('owner', { deleteInspection: false }).deleteInspection).toBe(true);
  });
});

describe('inspectionFees and companyFinance', () => {
  it('defaults: owner and manager have both, inspector has fees only, agent has neither', () => {
    for (const r of ['owner', 'manager'] as const) {
      expect(getCapabilities(r, null)).toMatchObject({ inspectionFees: true, companyFinance: true });
    }
    expect(getCapabilities('inspector', null)).toMatchObject({ inspectionFees: true, companyFinance: false });
    expect(getCapabilities('agent', null)).toMatchObject({ inspectionFees: false, companyFinance: false });
  });
  it('overrides move each one independently', () => {
    const c = getCapabilities('inspector', { inspectionFees: false, companyFinance: true });
    expect(c.inspectionFees).toBe(false);
    expect(c.companyFinance).toBe(true);
  });
  it('owner is never reduced and agent is never elevated, for both', () => {
    expect(getCapabilities('owner', { inspectionFees: false, companyFinance: false })).toMatchObject({ inspectionFees: true, companyFinance: true });
    expect(getCapabilities('agent', { inspectionFees: true, companyFinance: true })).toMatchObject({ inspectionFees: false, companyFinance: false });
  });
  it('there is no `financial` capability any more', () => {
    expect(TOGGLEABLE).not.toContain('financial' as never);
  });
});
