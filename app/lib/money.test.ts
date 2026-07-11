import { describe, it, expect } from 'vitest';
import { formatCents, parseDollarsToCents, formatDollars, parseCurrencyToCents } from '~/lib/money';

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

describe('formatDollars', () => {
  it('shows whole dollars with no cents when the amount is whole', () => {
    expect(formatDollars(0)).toBe('$0');
    expect(formatDollars(850000)).toBe('$8,500');
    expect(formatDollars(185000000)).toBe('$1,850,000');
  });
  it('shows two decimals only when the amount carries cents', () => {
    expect(formatDollars(850050)).toBe('$8,500.50');
    expect(formatDollars(45099)).toBe('$450.99');
  });
});

describe('parseCurrencyToCents', () => {
  it('accepts plain, comma-grouped, $-prefixed and decimal input', () => {
    expect(parseCurrencyToCents('8500')).toBe(850000);
    expect(parseCurrencyToCents('8,500')).toBe(850000);
    expect(parseCurrencyToCents('$8,500.50')).toBe(850050);
    expect(parseCurrencyToCents('1,850,000')).toBe(185000000);
    expect(parseCurrencyToCents(' 12.34 ')).toBe(1234);
  });
  it('returns null for empty / non-numeric input', () => {
    expect(parseCurrencyToCents('')).toBeNull();
    expect(parseCurrencyToCents('$')).toBeNull();
    expect(parseCurrencyToCents('abc')).toBeNull();
  });
});
