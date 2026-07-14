import { describe, it, expect } from 'vitest';
import { TIMEZONE_OPTIONS } from './timezones';

describe('TIMEZONE_OPTIONS', () => {
  it('is a non-empty list including common US zones', () => {
    expect(TIMEZONE_OPTIONS.length).toBeGreaterThan(50);
    expect(TIMEZONE_OPTIONS).toContain('America/New_York');
    expect(TIMEZONE_OPTIONS).toContain('UTC');
  });
});
