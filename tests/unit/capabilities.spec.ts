import { describe, it, expect } from 'vitest';
import { getCapabilities } from '../../server/lib/auth/capabilities';

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
