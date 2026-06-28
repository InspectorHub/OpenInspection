// apps/openinspection/server/lib/automation-core/required-vars.ts
import { referencedVars } from './interpolate';

/**
 * Generalized fail-closed guard. OI hardcoded "if the body/subject references
 * {{review_url}} and tenant_configs.review_url is unset → skip". Here that is
 * data-driven: the adapter passes a map of fail-closed vars (name → resolved
 * value). If any such var is referenced by a template but resolves falsy, the
 * action is skipped and the missing key is reported (caller logs the reason,
 * e.g. "review_url not configured"). Vars absent from the map are not gated.
 */
export function checkRequiredVars(
  templates: string[],
  requiredVars: Record<string, string | undefined>,
): { ok: true } | { ok: false; missingKey: string } {
  const referenced = new Set<string>();
  for (const t of templates) for (const v of referencedVars(t)) referenced.add(v);
  for (const [key, value] of Object.entries(requiredVars)) {
    if (referenced.has(key) && !value) return { ok: false, missingKey: key };
  }
  return { ok: true };
}
