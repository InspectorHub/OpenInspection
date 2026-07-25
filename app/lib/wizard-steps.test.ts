import { describe, it, expect } from 'vitest';
import { buildWizardSteps, todayLocalISO, formatPriceCents } from '~/lib/wizard-steps';

/**
 * FE-7 — services.price is stored in CENTS (schema comment, and every other
 * consumer divides by 100); the wizard rendered the raw integer ("$40000"
 * for a $400 inspection).
 */
describe('formatPriceCents', () => {
  it('formats cents as dollars with two decimals', () => {
    expect(formatPriceCents(40000)).toBe('$400.00');
    expect(formatPriceCents(15000)).toBe('$150.00');
    expect(formatPriceCents(9950)).toBe('$99.50');
  });

  it('handles zero and null-ish safely', () => {
    expect(formatPriceCents(0)).toBe('$0.00');
    expect(formatPriceCents(null)).toBe('$0.00');
    expect(formatPriceCents(undefined)).toBe('$0.00');
  });
});

/**
 * B-21 — the New Inspection wizard always walked Property → Services →
 * Schedule → Team even when Services was an empty "nothing configured"
 * placeholder and Team had no choices beyond Solo. Steps with nothing to
 * decide are skipped; the date defaults to today instead of blank.
 *
 * IA-1 — People step inserted unconditionally after Property so client + agent
 * capture is always reachable regardless of catalog or team configuration.
 *
 * Batch D — Schedule and Team were each ONE decision on a step of their own (a
 * date field; a two-way radio), and whichever came last was where "Create"
 * lived, so the wizard ended without ever showing what it was about to create.
 * They are now one final `confirm` step: both controls plus a review of every
 * earlier answer. That also removes the `hasTeamChoices` input — an empty team
 * hides a control inside the step now, it does not remove a step.
 */
describe('buildWizardSteps', () => {
  it('always includes people as the second step', () => {
    expect(buildWizardSteps({ hasServiceCatalog: true })[1]).toBe('people');
    expect(buildWizardSteps({ hasServiceCatalog: false })[1]).toBe('people');
  });

  it('ends on confirm, which carries the schedule, the assignee and the review', () => {
    expect(buildWizardSteps({ hasServiceCatalog: true }))
      .toEqual(['property', 'people', 'services', 'confirm']);
  });

  it('skips Services when the tenant has no service catalog', () => {
    expect(buildWizardSteps({ hasServiceCatalog: false }))
      .toEqual(['property', 'people', 'confirm']);
  });
});

describe('todayLocalISO', () => {
  it('formats a date as local YYYY-MM-DD', () => {
    expect(todayLocalISO(new Date(2026, 5, 4, 9, 30))).toBe('2026-06-04');
  });

  it('pads single-digit month/day', () => {
    expect(todayLocalISO(new Date(2026, 0, 7))).toBe('2026-01-07');
  });

  it('uses local time, not UTC (23:30 local on the 4th stays the 4th)', () => {
    expect(todayLocalISO(new Date(2026, 5, 4, 23, 30))).toBe('2026-06-04');
  });
});
