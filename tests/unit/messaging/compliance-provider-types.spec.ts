import { describe, it, expect } from 'vitest';
import { isComplianceChannel, COMPLIANCE_STATUSES } from '../../../server/lib/messaging/compliance-provider';

describe('compliance-provider types', () => {
  it('isComplianceChannel accepts the two channels and rejects others', () => {
    expect(isComplianceChannel('sp10dlc')).toBe(true);
    expect(isComplianceChannel('tollfree')).toBe(true);
    expect(isComplianceChannel('mms')).toBe(false);
  });
  it('exposes the 7 normalized statuses in order', () => {
    expect(COMPLIANCE_STATUSES).toEqual([
      'not_started','profile_pending','brand_pending','campaign_pending','tfv_pending','approved','rejected',
    ]);
  });
});
