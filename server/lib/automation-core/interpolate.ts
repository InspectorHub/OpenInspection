// apps/openinspection/server/lib/automation-core/interpolate.ts

/**
 * Replace {{name}} tokens with values from `vars`; missing keys → empty string.
 * Byte-identical to the OI `interpolate` helper (server/services/automation/shared.ts)
 * so vendored consumers and OI render templates the same way.
 */
export function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}

/** Escapes a value for an HTML text or attribute position. Kept local: this module has no imports. */
function escapeHtmlValue(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * `interpolate` for an HTML email body: substituted values are escaped, the
 * author's own markup is not. Subjects and SMS bodies use `interpolate`.
 */
export function interpolateHtml(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => escapeHtmlValue(vars[key] ?? ''));
}

/** Distinct {{name}} tokens referenced by a template (used by requiredVars). */
export function referencedVars(template: string): string[] {
  const out: string[] = [];
  for (const m of template.matchAll(/\{\{(\w+)\}\}/g)) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}
