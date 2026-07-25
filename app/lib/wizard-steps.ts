/**
 * B-21 — New Inspection wizard step plan + date default.
 *
 * Steps with nothing to decide are skipped instead of rendered as empty
 * placeholders the inspector has to click through: Services disappears when
 * the tenant has no service catalog. The Schedule date defaults to "today" in
 * the inspector's local timezone — on-site creation is overwhelmingly same-day.
 *
 * Batch D — Schedule and Team were each one decision on a step of their own (a
 * date field; a two-way radio), and whichever came last was where "Create"
 * lived, so the wizard ended without ever stating what it was about to create.
 * They are now one `confirm` step: both controls, plus a review of every earlier
 * answer. An empty team hides a control inside that step rather than removing a
 * step, which is why `hasTeamChoices` is gone.
 */

import { m } from '~/paraglide/messages';

export type WizardStepId = 'property' | 'people' | 'services' | 'confirm';

/** Everything the step gate reads, flattened so the rule is pure. */
export interface StepGateState {
  address: string;
  templateId: string;
  clientNameMissing: boolean;
  serviceCount: number;
  date: string;
  holidayBlocked: boolean;
}

/**
 * Why the wizard will not move on — or null when it will.
 *
 * `Next` used to be disabled with nothing said. On Property it greys out until
 * BOTH an address and a template are set, and on Services until a service is
 * ticked, so the inspector is left comparing a dead button against a form that
 * looks filled in. A disabled control has to name its own condition; that is the
 * whole reason this returns a sentence instead of a boolean.
 *
 * Order matters: the reason names the FIRST thing to fix, reading down the step.
 */
export function stepBlockedReason(step: WizardStepId, s: StepGateState): string | null {
  switch (step) {
    case 'property':
      // propertyAddress has a min(5) server constraint — enforce it here so the
      // wizard cannot advance into an inevitable 400.
      if (s.address.trim().length < 5) return m.newinsp_gate_address();
      if (s.templateId.length === 0) return m.newinsp_gate_template();
      return null;
    case 'people':
      // People is optional as a whole, but a contact detail with no name is not
      // a person.
      return s.clientNameMissing ? m.newinsp_gate_client_name() : null;
    case 'services':
      return s.serviceCount === 0 ? m.newinsp_gate_service() : null;
    case 'confirm':
      if (s.date.length === 0) return m.newinsp_gate_date();
      if (s.holidayBlocked) return m.newinsp_gate_holiday();
      return null;
  }
}

export function buildWizardSteps(opts: {
  hasServiceCatalog: boolean;
}): WizardStepId[] {
  const steps: WizardStepId[] = ['property'];
  // IA-1 — People (client + agent) is always present: capturing who is
  // involved is useful for any inspection regardless of catalog or team size.
  steps.push('people');
  if (opts.hasServiceCatalog) steps.push('services');
  steps.push('confirm');
  return steps;
}

export function todayLocalISO(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * FE-7 — services.price is stored in cents (see services schema comment);
 * render it like every other consumer ($X.XX), not as the raw integer.
 */
export function formatPriceCents(cents: number | null | undefined): string {
  return `$${((cents ?? 0) / 100).toFixed(2)}`;
}
