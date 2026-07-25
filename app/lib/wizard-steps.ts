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

export type WizardStepId = 'property' | 'people' | 'services' | 'confirm';

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
