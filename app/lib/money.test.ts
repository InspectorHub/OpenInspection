import { describe, it, expect } from 'vitest';
import { formatCents, parseDollarsToCents } from '~/lib/money';

describe('formatCents', () => {
  it('formats integer cents as $X,XXX.XX', () => {
    expect(formatCents(0)).toBe('$0.00');
    expect(formatCents(45000)).toBe('$450.00');
    expect(formatCents(500000)).toBe('$5,000.00');
    expect(formatCents(185000000)).toBe('$1,850,000.00');
  });
});

describe('parseDollarsToCents', () => {
  it('parses a dollar string to integer cents', () => {
    expect(parseDollarsToCents('12.34')).toBe(1234);
    expect(parseDollarsToCents('1000')).toBe(100000);
    expect(parseDollarsToCents(' 5 ')).toBe(500);
  });
  it('returns null for empty / non-numeric input', () => {
    expect(parseDollarsToCents('')).toBeNull();
    expect(parseDollarsToCents('   ')).toBeNull();
    expect(parseDollarsToCents('abc')).toBeNull();
  });
});
