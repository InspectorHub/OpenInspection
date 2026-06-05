import { describe, it, expect } from 'vitest';
import { computeOnboardingSteps, allDone } from '~/lib/onboarding-progress';
import type { OnboardingInput, OnboardingStep } from '~/lib/onboarding-progress';

// ---------------------------------------------------------------------------
// computeOnboardingSteps
// ---------------------------------------------------------------------------

describe('computeOnboardingSteps', () => {
  it('returns all four steps in fixed order', () => {
    const steps = computeOnboardingSteps({
      siteNameSet: false,
      templateCount: 0,
      serviceCount: 0,
      inspectionCount: 0,
    });
    expect(steps).toHaveLength(4);
    const ids = steps.map((s) => s.id);
    expect(ids).toEqual(['company', 'template', 'services', 'first-inspection']);
  });

  it('marks all steps done when all criteria are met', () => {
    const steps = computeOnboardingSteps({
      siteNameSet: true,
      templateCount: 3,
      serviceCount: 2,
      inspectionCount: 5,
    });
    expect(steps.every((s) => s.done)).toBe(true);
  });

  it('marks all steps not-done when tenant is brand new', () => {
    const steps = computeOnboardingSteps({
      siteNameSet: false,
      templateCount: 0,
      serviceCount: 0,
      inspectionCount: 0,
    });
    expect(steps.every((s) => !s.done)).toBe(true);
  });

  it('company step: done when siteNameSet=true, not done when false', () => {
    const withName = computeOnboardingSteps({ siteNameSet: true, templateCount: 0, serviceCount: 0, inspectionCount: 0 });
    const withoutName = computeOnboardingSteps({ siteNameSet: false, templateCount: 1, serviceCount: 1, inspectionCount: 1 });

    const companyDone = withName.find((s) => s.id === 'company')!;
    const companyMissing = withoutName.find((s) => s.id === 'company')!;

    expect(companyDone.done).toBe(true);
    expect(companyMissing.done).toBe(false);
  });

  it('template step: done when templateCount >= 1, not done at 0', () => {
    const done = computeOnboardingSteps({ siteNameSet: false, templateCount: 1, serviceCount: 0, inspectionCount: 0 });
    const notDone = computeOnboardingSteps({ siteNameSet: true, templateCount: 0, serviceCount: 1, inspectionCount: 1 });

    expect(done.find((s) => s.id === 'template')!.done).toBe(true);
    expect(notDone.find((s) => s.id === 'template')!.done).toBe(false);
  });

  it('services step: done when serviceCount >= 1, not done at 0', () => {
    const done = computeOnboardingSteps({ siteNameSet: false, templateCount: 0, serviceCount: 1, inspectionCount: 0 });
    const notDone = computeOnboardingSteps({ siteNameSet: true, templateCount: 1, serviceCount: 0, inspectionCount: 1 });

    expect(done.find((s) => s.id === 'services')!.done).toBe(true);
    expect(notDone.find((s) => s.id === 'services')!.done).toBe(false);
  });

  it('first-inspection step: done when inspectionCount >= 1, not done at 0', () => {
    const done = computeOnboardingSteps({ siteNameSet: false, templateCount: 0, serviceCount: 0, inspectionCount: 1 });
    const notDone = computeOnboardingSteps({ siteNameSet: true, templateCount: 1, serviceCount: 1, inspectionCount: 0 });

    expect(done.find((s) => s.id === 'first-inspection')!.done).toBe(true);
    expect(notDone.find((s) => s.id === 'first-inspection')!.done).toBe(false);
  });

  it('first-inspection step has href "#new-inspection"', () => {
    const steps = computeOnboardingSteps({ siteNameSet: false, templateCount: 0, serviceCount: 0, inspectionCount: 0 });
    const step = steps.find((s) => s.id === 'first-inspection')!;
    expect(step.href).toBe('#new-inspection');
  });

  it('company step links to /settings/workspace', () => {
    const steps = computeOnboardingSteps({ siteNameSet: false, templateCount: 0, serviceCount: 0, inspectionCount: 0 });
    expect(steps.find((s) => s.id === 'company')!.href).toBe('/settings/workspace');
  });

  it('template step links to /templates', () => {
    const steps = computeOnboardingSteps({ siteNameSet: false, templateCount: 0, serviceCount: 0, inspectionCount: 0 });
    expect(steps.find((s) => s.id === 'template')!.href).toBe('/templates');
  });

  it('services step links to /settings/services', () => {
    const steps = computeOnboardingSteps({ siteNameSet: false, templateCount: 0, serviceCount: 0, inspectionCount: 0 });
    expect(steps.find((s) => s.id === 'services')!.href).toBe('/settings/services');
  });

  it('partial completion: only matching steps are done', () => {
    const steps = computeOnboardingSteps({
      siteNameSet: true,
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
      { id: 'template', label: 'B', done: true, href: '/b' },
      { id: 'services', label: 'C', done: true, href: '/c' },
      { id: 'first-inspection', label: 'D', done: true, href: '#new-inspection' },
    ];
    expect(allDone(steps)).toBe(true);
  });

  it('returns false when at least one step is not done', () => {
    const steps: OnboardingStep[] = [
      { id: 'company', label: 'A', done: true, href: '/a' },
      { id: 'template', label: 'B', done: false, href: '/b' },
      { id: 'services', label: 'C', done: true, href: '/c' },
      { id: 'first-inspection', label: 'D', done: true, href: '#new-inspection' },
    ];
    expect(allDone(steps)).toBe(false);
  });

  it('returns false for all-undone steps', () => {
    const steps = computeOnboardingSteps({
      siteNameSet: false,
      templateCount: 0,
      serviceCount: 0,
      inspectionCount: 0,
    });
    expect(allDone(steps)).toBe(false);
  });

  it('returns true for a fully-done set via computeOnboardingSteps', () => {
    const steps = computeOnboardingSteps({
      siteNameSet: true,
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
