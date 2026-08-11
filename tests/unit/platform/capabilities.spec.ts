import { describe, it, expect } from 'vitest';
import { getCapabilities, TOGGLEABLE } from '../../../server/lib/auth/capabilities';

describe('getCapabilities', () => {
  it('inspector defaults: publish on, schedule self, no financial, no contacts', () => {
    expect(getCapabilities('inspector', null)).toMatchObject({ publish: true, scheduleOthers: false, financial: false, manageContacts: false });
  });
  it('manager defaults: all four on', () => {
    expect(getCapabilities('manager', null)).toMatchObject({ publish: true, scheduleOthers: true, financial: true, manageContacts: true });
  });
  it('overrides win over role defaults', () => {
    const c = getCapabilities('inspector', { financial: true, publish: false });
    expect(c.financial).toBe(true); expect(c.publish).toBe(false);
  });
  it('owner is always fully capable, ignoring reducing overrides', () => {
    expect(getCapabilities('owner', { financial: false }).financial).toBe(true);
  });
  it('agent has none of the staff capabilities', () => {
    expect(getCapabilities('agent', null)).toMatchObject({ publish: false, scheduleOthers: false, financial: false, manageContacts: false });
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
 * over-generous override row and a stranger with the `financial` bit.
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
