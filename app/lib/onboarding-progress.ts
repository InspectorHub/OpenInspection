/**
 * Onboarding checklist — pure functions for the dashboard "Getting started" banner.
 *
 * All logic is side-effect-free so it can be tested in isolation (no DOM, no
 * network) and reused from both the loader (server) and the component (client).
 */

export interface OnboardingInput {
  /** True when the tenant has saved a company/site name other than the system default. */
  companyNameSet: boolean;
  /** Number of inspection templates that exist for this tenant. */
  templateCount: number;
  /** Number of services that exist for this tenant. */
  serviceCount: number;
  /** Number of inspections created for this tenant (any status). */
  inspectionCount: number;
  /** True when the tenant set a non-UTC default_timezone. */
  timezoneSet: boolean;
  /** True when the user has weekly availability or a connected calendar. */
  scheduleSet: boolean;
}

export interface OnboardingStep {
  id: 'company' | 'timezone' | 'template' | 'services' | 'schedule' | 'first-inspection';
  label: string;
  done: boolean;
  /** Navigation href for the step. '#new-inspection' is a magic value the
   *  OnboardingChecklist component resolves to "open the New Inspection wizard". */
  href: string;
}

/**
 * Derives the ordered onboarding steps from raw counts/flags.
 * Always returns every step in fixed order so the UI never shifts.
 */
export function computeOnboardingSteps(input: OnboardingInput): OnboardingStep[] {
  return [
    {
      id: 'company',
      label: 'Set your company name',
      done: input.companyNameSet,
      href: '/settings/workspace',
    },
    {
      id: 'timezone',
      label: 'Set your timezone',
      done: input.timezoneSet,
      href: '/settings/workspace',
    },
    {
      id: 'template',
      label: 'Have an inspection template',
      done: input.templateCount > 0,
      href: '/library/templates',
    },
    {
      id: 'services',
      label: 'Price your services',
      done: input.serviceCount > 0,
      href: '/settings/services',
    },
    {
      id: 'schedule',
      label: 'Set up your schedule',
      done: input.scheduleSet,
      href: '/settings/schedule',
    },
    {
      id: 'first-inspection',
      label: 'Create your first inspection',
      done: input.inspectionCount > 0,
      href: '#new-inspection',
    },
  ];
}

/**
 * Returns true when every onboarding step is done.
 * Used to auto-hide the checklist once the user has completed all steps.
 */
export function allDone(steps: OnboardingStep[]): boolean {
  return steps.every((s) => s.done);
}
