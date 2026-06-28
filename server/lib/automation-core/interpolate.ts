// apps/openinspection/server/lib/automation-core/interpolate.ts

/**
 * Replace {{name}} tokens with values from `vars`; missing keys → empty string.
 * Byte-identical to the OI `interpolate` helper (server/services/automation/shared.ts)
 * so vendored consumers and OI render templates the same way.
 */
export function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}

/** Distinct {{name}} tokens referenced by a template (used by requiredVars). */
export function referencedVars(template: string): string[] {
  const out: string[] = [];
  for (const m of template.matchAll(/\{\{(\w+)\}\}/g)) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}
