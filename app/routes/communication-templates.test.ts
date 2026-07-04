import { describe, it, expect } from 'vitest';
import { smsSegmentsClient } from '~/routes/settings-communication-templates';

// The route module exports a tiny pure helper used by the SMS editor so it is
// unit-testable without a DOM. (Mirror server smsSegmentInfo thresholds.)
describe('settings-communication-templates client helpers', () => {
  it('smsSegmentsClient matches the carrier thresholds', () => {
    expect(smsSegmentsClient('')).toBe(0);
    expect(smsSegmentsClient('short')).toBe(1);
    expect(smsSegmentsClient('a'.repeat(161))).toBe(2);
  });
});
