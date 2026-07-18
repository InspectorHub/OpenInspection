import { describe, it, expect } from 'vitest';
import { capabilitiesForKind } from '../../../server/lib/people/capabilities';

describe('capabilitiesForKind', () => {
  it('client can self-retrieve, sign, pay; not account', () => {
    expect(capabilitiesForKind('client')).toEqual({
      receivesReport: true, selfRetrieveReport: true, canSign: true, canPay: true, canHaveAccount: false,
    });
  });
  it('agent can sign/pay + account, but not self-retrieve (Spec 1 latent)', () => {
    expect(capabilitiesForKind('agent')).toEqual({
      receivesReport: true, selfRetrieveReport: false, canSign: true, canPay: true, canHaveAccount: true,
    });
  });
  it('other only receives report', () => {
    expect(capabilitiesForKind('other')).toEqual({
      receivesReport: true, selfRetrieveReport: false, canSign: false, canPay: false, canHaveAccount: false,
    });
  });
});
