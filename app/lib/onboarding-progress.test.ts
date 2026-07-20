import { describe, it, expect } from 'vitest';
import { computeOnboardingSteps, allDone } from '~/lib/onboarding-progress';
import type { OnboardingStep } from '~/lib/onboarding-progress';

// ---------------------------------------------------------------------------
// computeOnboardingSteps
// ---------------------------------------------------------------------------

describe('computeOnboardingSteps', () => {
  it('returns all six steps in fixed order', () => {
    const steps = computeOnboardingSteps({
      companyNameSet: false,
      timezoneSet: false,
      templateCount: 0,
      serviceCount: 0,
      inspectionCount: 0,
      scheduleSet: false,
    });
    expect(steps).toHaveLength(6);
    const ids = steps.map((s) => s.id);
    expect(ids).toEqual(['company', 'timezone', 'template', 'services', 'schedule', 'first-inspection']);
  });

  it('marks all steps done when all criteria are met', () => {
    const steps = computeOnboardingSteps({
      companyNameSet: true,
      timezoneSet: true,
      templateCount: 3,
      serviceCount: 2,
      inspectionCount: 5,
      scheduleSet: true,
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
      scheduleSet: false,
    });
    expect(steps.every((s) => !s.done)).toBe(true);
  });

  it('company step: done when companyNameSet=true, not done when false', () => {
    const withName = computeOnboardingSteps({ companyNameSet: true, timezoneSet: false, templateCount: 0, serviceCount: 0, inspectionCount: 0, scheduleSet: false });
    const withoutName = computeOnboardingSteps({ companyNameSet: false, timezoneSet: true, templateCount: 1, serviceCount: 1, inspectionCount: 1, scheduleSet: true });

    expect(withName.find((s) => s.id === 'company')!.done).toBe(true);
    expect(withoutName.find((s) => s.id === 'company')!.done).toBe(false);
  });

  it('timezone step: done when timezoneSet=true, not done when false; links to /settings/workspace', () => {
    const setTz = computeOnboardingSteps({ companyNameSet: true, timezoneSet: true, templateCount: 0, serviceCount: 0, inspectionCount: 0, scheduleSet: false });
    const noTz = computeOnboardingSteps({ companyNameSet: true, timezoneSet: false, templateCount: 0, serviceCount: 0, inspectionCount: 0, scheduleSet: false });

    const tzStep = noTz.find((s) => s.id === 'timezone')!;
    expect(tzStep.done).toBe(false);
    expect(tzStep.href).toBe('/settings/workspace?setup=timezone');
    expect(tzStep.label).toBe('Set your timezone');
    expect(setTz.find((s) => s.id === 'timezone')!.done).toBe(true);
  });

  it('template step: done when templateCount >= 1, not done at 0', () => {
    const done = computeOnboardingSteps({ companyNameSet: false, timezoneSet: false, templateCount: 1, serviceCount: 0, inspectionCount: 0, scheduleSet: false });
    const notDone = computeOnboardingSteps({ companyNameSet: true, timezoneSet: false, templateCount: 0, serviceCount: 1, inspectionCount: 1, scheduleSet: true });

    expect(done.find((s) => s.id === 'template')!.done).toBe(true);
    expect(notDone.find((s) => s.id === 'template')!.done).toBe(false);
  });

  it('services step: done when serviceCount >= 1, not done at 0', () => {
    const done = computeOnboardingSteps({ companyNameSet: false, timezoneSet: false, templateCount: 0, serviceCount: 1, inspectionCount: 0, scheduleSet: false });
    const notDone = computeOnboardingSteps({ companyNameSet: true, timezoneSet: false, templateCount: 1, serviceCount: 0, inspectionCount: 1, scheduleSet: true });

    expect(done.find((s) => s.id === 'services')!.done).toBe(true);
    expect(notDone.find((s) => s.id === 'services')!.done).toBe(false);
  });

  it('first-inspection step: done when inspectionCount >= 1, not done at 0', () => {
    const done = computeOnboardingSteps({ companyNameSet: false, timezoneSet: false, templateCount: 0, serviceCount: 0, inspectionCount: 1, scheduleSet: false });
    const notDone = computeOnboardingSteps({ companyNameSet: true, timezoneSet: false, templateCount: 1, serviceCount: 1, inspectionCount: 0, scheduleSet: true });

    expect(done.find((s) => s.id === 'first-inspection')!.done).toBe(true);
    expect(notDone.find((s) => s.id === 'first-inspection')!.done).toBe(false);
  });

  it('first-inspection step has href "#new-inspection"', () => {
    const steps = computeOnboardingSteps({ companyNameSet: false, timezoneSet: false, templateCount: 0, serviceCount: 0, inspectionCount: 0, scheduleSet: false });
    expect(steps.find((s) => s.id === 'first-inspection')!.href).toBe('#new-inspection');
  });

  it('company step links to /settings/workspace', () => {
    const steps = computeOnboardingSteps({ companyNameSet: false, timezoneSet: false, templateCount: 0, serviceCount: 0, inspectionCount: 0, scheduleSet: false });
    expect(steps.find((s) => s.id === 'company')!.href).toBe('/settings/workspace');
  });

  it('template step links to /library/templates', () => {
    const steps = computeOnboardingSteps({ companyNameSet: false, timezoneSet: false, templateCount: 0, serviceCount: 0, inspectionCount: 0, scheduleSet: false });
    expect(steps.find((s) => s.id === 'template')!.href).toBe('/library/templates');
  });

  it('services step links to /settings/services', () => {
    const steps = computeOnboardingSteps({ companyNameSet: false, timezoneSet: false, templateCount: 0, serviceCount: 0, inspectionCount: 0, scheduleSet: false });
    expect(steps.find((s) => s.id === 'services')!.href).toBe('/settings/services');
  });

  it('includes a schedule step driven by scheduleSet', () => {
    const pending = computeOnboardingSteps({ companyNameSet: false, timezoneSet: false, templateCount: 0, serviceCount: 0, inspectionCount: 0, scheduleSet: false });
    const done = computeOnboardingSteps({ companyNameSet: false, timezoneSet: false, templateCount: 0, serviceCount: 0, inspectionCount: 0, scheduleSet: true });

    expect(pending.find((s) => s.id === 'schedule')).toMatchObject({
      label: 'Set up your schedule',
      done: false,
      href: '/settings/schedule',
    });
    expect(done.find((s) => s.id === 'schedule')?.done).toBe(true);
  });

  it('partial completion: only matching steps are done', () => {
    const steps = computeOnboardingSteps({
      companyNameSet: true,
      timezoneSet: false,
      templateCount: 0,
      serviceCount: 2,
      inspectionCount: 0,
      scheduleSet: false,
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
      scheduleSet: false,
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
      scheduleSet: true,
    });
    expect(allDone(steps)).toBe(true);
  });

  it('returns true for an empty step array (vacuous truth)', () => {
    expect(allDone([])).toBe(true);
  });
});
