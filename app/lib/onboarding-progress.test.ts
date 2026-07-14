import { describe, it, expect } from 'vitest';
import { computeOnboardingSteps, allDone } from '~/lib/onboarding-progress';
import type { OnboardingStep } from '~/lib/onboarding-progress';

// ---------------------------------------------------------------------------
// computeOnboardingSteps
// ---------------------------------------------------------------------------

describe('computeOnboardingSteps', () => {
  it('returns all five steps in fixed order', () => {
    const steps = computeOnboardingSteps({
      companyNameSet: false,
      timezoneSet: false,
      templateCount: 0,
      serviceCount: 0,
      inspectionCount: 0,
    });
    expect(steps).toHaveLength(5);
    const ids = steps.map((s) => s.id);
    expect(ids).toEqual(['company', 'timezone', 'template', 'services', 'first-inspection']);
  });

  it('marks all steps done when all criteria are met', () => {
    const steps = computeOnboardingSteps({
      companyNameSet: true,
      timezoneSet: true,
      templateCount: 3,
      serviceCount: 2,
      inspectionCount: 5,
    });
    expect(steps.every((s) => s.done)).toBe(true);
  });

  it('marks all steps not-done when tenant is brand new', () => {
    const steps = computeOnboardingSteps({
      companyNameSet: false,
      timezoneSet: false,
      templateCount: 0,
      serviceCount: 0,
      inspectionCount: 0,
    });
    expect(steps.every((s) => !s.done)).toBe(true);
  });

  it('company step: done when companyNameSet=true, not done when false', () => {
    const withName = computeOnboardingSteps({ companyNameSet: true, timezoneSet: false, templateCount: 0, serviceCount: 0, inspectionCount: 0 });
    const withoutName = computeOnboardingSteps({ companyNameSet: false, timezoneSet: true, templateCount: 1, serviceCount: 1, inspectionCount: 1 });

    expect(withName.find((s) => s.id === 'company')!.done).toBe(true);
    expect(withoutName.find((s) => s.id === 'company')!.done).toBe(false);
  });

  it('timezone step: done when timezoneSet=true, not done when false; links to /settings/workspace', () => {
    const setTz = computeOnboardingSteps({ companyNameSet: true, timezoneSet: true, templateCount: 0, serviceCount: 0, inspectionCount: 0 });
    const noTz = computeOnboardingSteps({ companyNameSet: true, timezoneSet: false, templateCount: 0, serviceCount: 0, inspectionCount: 0 });

    const tzStep = noTz.find((s) => s.id === 'timezone')!;
    expect(tzStep.done).toBe(false);
    expect(tzStep.href).toBe('/settings/workspace');
    expect(tzStep.label).toBe('Set your timezone');
    expect(setTz.find((s) => s.id === 'timezone')!.done).toBe(true);
  });

  it('template step: done when templateCount >= 1, not done at 0', () => {
    const done = computeOnboardingSteps({ companyNameSet: false, timezoneSet: false, templateCount: 1, serviceCount: 0, inspectionCount: 0 });
    const notDone = computeOnboardingSteps({ companyNameSet: true, timezoneSet: false, templateCount: 0, serviceCount: 1, inspectionCount: 1 });

    expect(done.find((s) => s.id === 'template')!.done).toBe(true);
    expect(notDone.find((s) => s.id === 'template')!.done).toBe(false);
  });

  it('services step: done when serviceCount >= 1, not done at 0', () => {
    const done = computeOnboardingSteps({ companyNameSet: false, timezoneSet: false, templateCount: 0, serviceCount: 1, inspectionCount: 0 });
    const notDone = computeOnboardingSteps({ companyNameSet: true, timezoneSet: false, templateCount: 1, serviceCount: 0, inspectionCount: 1 });

    expect(done.find((s) => s.id === 'services')!.done).toBe(true);
    expect(notDone.find((s) => s.id === 'services')!.done).toBe(false);
  });

  it('first-inspection step: done when inspectionCount >= 1, not done at 0', () => {
    const done = computeOnboardingSteps({ companyNameSet: false, timezoneSet: false, templateCount: 0, serviceCount: 0, inspectionCount: 1 });
    const notDone = computeOnboardingSteps({ companyNameSet: true, timezoneSet: false, templateCount: 1, serviceCount: 1, inspectionCount: 0 });

    expect(done.find((s) => s.id === 'first-inspection')!.done).toBe(true);
    expect(notDone.find((s) => s.id === 'first-inspection')!.done).toBe(false);
  });

  it('first-inspection step has href "#new-inspection"', () => {
    const steps = computeOnboardingSteps({ companyNameSet: false, timezoneSet: false, templateCount: 0, serviceCount: 0, inspectionCount: 0 });
    expect(steps.find((s) => s.id === 'first-inspection')!.href).toBe('#new-inspection');
  });

  it('company step links to /settings/workspace', () => {
    const steps = computeOnboardingSteps({ companyNameSet: false, timezoneSet: false, templateCount: 0, serviceCount: 0, inspectionCount: 0 });
    expect(steps.find((s) => s.id === 'company')!.href).toBe('/settings/workspace');
  });

  it('template step links to /library/templates', () => {
    const steps = computeOnboardingSteps({ companyNameSet: false, timezoneSet: false, templateCount: 0, serviceCount: 0, inspectionCount: 0 });
    expect(steps.find((s) => s.id === 'template')!.href).toBe('/library/templates');
  });

  it('services step links to /settings/services', () => {
    const steps = computeOnboardingSteps({ companyNameSet: false, timezoneSet: false, templateCount: 0, serviceCount: 0, inspectionCount: 0 });
    expect(steps.find((s) => s.id === 'services')!.href).toBe('/settings/services');
  });

  it('partial completion: only matching steps are done', () => {
    const steps = computeOnboardingSteps({
      companyNameSet: true,
      timezoneSet: false,
      templateCount: 0,
      serviceCount: 2,
      inspectionCount: 0,
    });
    const doneIds = steps.filter((s) => s.done).map((s) => s.id);
    expect(doneIds).toEqual(['company', 'services']);
  });
});

// ---------------------------------------------------------------------------
// allDone
// ---------------------------------------------------------------------------

describe('allDone', () => {
  it('returns true when every step is done', () => {
    const steps: OnboardingStep[] = [
      { id: 'company', label: 'A', done: true, href: '/a' },
      { id: 'timezone', label: 'TZ', done: true, href: '/tz' },
      { id: 'template', label: 'B', done: true, href: '/b' },
      { id: 'services', label: 'C', done: true, href: '/c' },
      { id: 'first-inspection', label: 'D', done: true, href: '#new-inspection' },
    ];
    expect(allDone(steps)).toBe(true);
  });

  it('returns false when at least one step is not done', () => {
    const steps: OnboardingStep[] = [
      { id: 'company', label: 'A', done: true, href: '/a' },
      { id: 'timezone', label: 'TZ', done: false, href: '/tz' },
      { id: 'template', label: 'B', done: true, href: '/b' },
      { id: 'services', label: 'C', done: true, href: '/c' },
      { id: 'first-inspection', label: 'D', done: true, href: '#new-inspection' },
    ];
    expect(allDone(steps)).toBe(false);
  });

  it('returns false for all-undone steps', () => {
    const steps = computeOnboardingSteps({
      companyNameSet: false,
      timezoneSet: false,
      templateCount: 0,
      serviceCount: 0,
      inspectionCount: 0,
    });
    expect(allDone(steps)).toBe(false);
  });

  it('returns true for a fully-done set via computeOnboardingSteps', () => {
    const steps = computeOnboardingSteps({
      companyNameSet: true,
      timezoneSet: true,
      templateCount: 1,
      serviceCount: 1,
      inspectionCount: 1,
    });
    expect(allDone(steps)).toBe(true);
  });

  it('returns true for an empty step array (vacuous truth)', () => {
    expect(allDone([])).toBe(true);
  });
});
