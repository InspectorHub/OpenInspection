import { describe, it, expect } from 'vitest';
import { stepBlockedReason, type StepGateState, buildWizardSteps, todayLocalISO, formatPriceCents } from '~/lib/wizard-steps';

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

/**
 * A disabled Next with no explanation happened twice in one wizard: Property
 * greys out until both an address and a template are set, Services until a
 * service is ticked. The button said nothing either time.
 */
describe("stepBlockedReason", () => {
    const ok: StepGateState = {
        address: "412 Alder Court, Springfield, IL",
        templateId: "tpl-1",
        clientNameMissing: false,
        serviceCount: 1,
        date: "2026-07-25",
        holidayBlocked: false,
    };

    it("is silent when the step is complete", () => {
        for (const step of ["property", "people", "services", "confirm"] as const) {
            expect(stepBlockedReason(step, ok)).toBeNull();
        }
    });

    it("names the address before the template — the first thing to fix, reading down", () => {
        expect(stepBlockedReason("property", { ...ok, address: "", templateId: "" })).toMatch(/address/i);
        expect(stepBlockedReason("property", { ...ok, templateId: "" })).toMatch(/template/i);
    });

    it("treats a too-short address as missing, matching the server's own bound", () => {
        expect(stepBlockedReason("property", { ...ok, address: "12 A" })).toMatch(/address/i);
    });

    it("explains the people rule, which is conditional and therefore invisible", () => {
        // Name is required only because an email or phone was filled in. Without
        // saying so, the inspector sees a dead button beside an empty name field
        // they were never asked to fill.
        expect(stepBlockedReason("people", { ...ok, clientNameMissing: true })).toMatch(/name/i);
    });

    it("asks for a service, and for a date", () => {
        expect(stepBlockedReason("services", { ...ok, serviceCount: 0 })).toMatch(/service/i);
        expect(stepBlockedReason("confirm", { ...ok, date: "" })).toMatch(/date/i);
    });

    it("distinguishes a blocked date from a missing one", () => {
        const blocked = stepBlockedReason("confirm", { ...ok, holidayBlocked: true });
        expect(blocked).toBeTruthy();
        expect(blocked).not.toBe(stepBlockedReason("confirm", { ...ok, date: "" }));
    });
});
