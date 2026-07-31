import { describe, it, expect } from 'vitest';
import { capabilitiesForKind } from '../../../server/lib/people/capabilities';

describe('capabilitiesForKind', () => {
  it('client can self-retrieve and receive a report; not account', () => {
    expect(capabilitiesForKind('client')).toEqual({
      receivesReport: true, selfRetrieveReport: true, canHaveAccount: false,
      showsInAgentPortal: false, canAccessRepairList: 'off',
    });
  });
  it('agent can self-retrieve, receive a report, and have an account (Spec 3 flip)', () => {
    expect(capabilitiesForKind('agent')).toEqual({
      receivesReport: true, selfRetrieveReport: true, canHaveAccount: true,
      showsInAgentPortal: true, canAccessRepairList: 'off',
    });
  });
  it('other only receives report', () => {
    expect(capabilitiesForKind('other')).toEqual({
      receivesReport: true, selfRetrieveReport: false, canHaveAccount: false,
      showsInAgentPortal: false, canAccessRepairList: 'off',
    });
  });
  it('no longer exposes the never-consumed canSign / canPay capability bits', () => {
    const caps = capabilitiesForKind('agent') as Record<string, unknown>;
    expect(caps.canSign).toBeUndefined();
    expect(caps.canPay).toBeUndefined();
  });
});

import { capabilitiesForProfile } from '../../../server/lib/people/capabilities';

describe('capabilitiesForProfile', () => {
    it('falls back to the kind default when there are no overrides', () => {
        expect(capabilitiesForProfile('agent', null)).toEqual({
            receivesReport: true, selfRetrieveReport: true, canHaveAccount: true,
            showsInAgentPortal: true, canAccessRepairList: 'off',
        });
    });

    it('applies a boolean override', () => {
        expect(capabilitiesForProfile('other', { selfRetrieveReport: true }).selfRetrieveReport).toBe(true);
    });

    it('applies the three-value repair-list override', () => {
        expect(capabilitiesForProfile('agent', { canAccessRepairList: 'read' }).canAccessRepairList).toBe('read');
    });

    it('drops an out-of-range repair-list value rather than storing it', () => {
        expect(capabilitiesForProfile('agent', { canAccessRepairList: 'admin' }).canAccessRepairList).toBe('off');
    });

    it('accepts overrides as a raw JSON string, as drizzle may hand them back', () => {
        expect(capabilitiesForProfile('agent', '{"showsInAgentPortal":false}').showsInAgentPortal).toBe(false);
    });

    it('fails closed for an unknown kind', () => {
        expect(capabilitiesForProfile('nonsense' as never, null)).toEqual({
            receivesReport: false, selfRetrieveReport: false, canHaveAccount: false,
            showsInAgentPortal: false, canAccessRepairList: 'off',
        });
    });
});
