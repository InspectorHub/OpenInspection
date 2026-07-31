import { describe, it, expect } from 'vitest';
import { getCapabilities } from '../../../server/lib/auth/capabilities';

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
