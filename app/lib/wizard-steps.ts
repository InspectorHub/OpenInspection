/**
 * B-21 — New Inspection wizard step plan + date default.
 *
 * Steps with nothing to decide are skipped instead of rendered as empty
 * placeholders the inspector has to click through: Services disappears when
 * the tenant has no service catalog, Team disappears when there is nobody to
 * pick (solo workspace). The Schedule date defaults to "today" in the
 * inspector's local timezone — on-site creation is overwhelmingly same-day.
 */

export type WizardStepId = 'property' | 'people' | 'services' | 'schedule' | 'team';

export function buildWizardSteps(opts: {
  hasServiceCatalog: boolean;
  hasTeamChoices: boolean;
}): WizardStepId[] {
  const steps: WizardStepId[] = ['property'];
  // IA-1 — People (client + agent) is always present: capturing who is
  // involved is useful for any inspection regardless of catalog or team size.
  steps.push('people');
  if (opts.hasServiceCatalog) steps.push('services');
  steps.push('schedule');
  if (opts.hasTeamChoices) steps.push('team');
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
