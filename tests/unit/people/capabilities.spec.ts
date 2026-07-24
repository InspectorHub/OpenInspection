import { describe, it, expect } from 'vitest';
import { capabilitiesForKind } from '../../../server/lib/people/capabilities';

describe('capabilitiesForKind', () => {
  it('client can self-retrieve and receive a report; not account', () => {
    expect(capabilitiesForKind('client')).toEqual({
      receivesReport: true, selfRetrieveReport: true, canHaveAccount: false,
    });
  });
  it('agent can self-retrieve, receive a report, and have an account (Spec 3 flip)', () => {
    expect(capabilitiesForKind('agent')).toEqual({
      receivesReport: true, selfRetrieveReport: true, canHaveAccount: true,
    });
  });
  it('other only receives report', () => {
    expect(capabilitiesForKind('other')).toEqual({
      receivesReport: true, selfRetrieveReport: false, canHaveAccount: false,
    });
  });
  it('no longer exposes the never-consumed canSign / canPay capability bits', () => {
    const caps = capabilitiesForKind('agent') as Record<string, unknown>;
    expect(caps.canSign).toBeUndefined();
    expect(caps.canPay).toBeUndefined();
  });
});
