/**
 * Email-template Phase 2 — escape-aware interpolation (spec §6).
 *
 * Template authors write PLAIN TEXT with `{{var}}` placeholders. Rendering
 * HTML-escapes the author's literal text AND each interpolated variable
 * value, and only substitutes variables that appear in the template's
 * declared `allowed` set. No author-supplied HTML can ever reach the email;
 * the only HTML is the system-owned layout chrome. This is deliberately NOT
 * raw Mustache (which emits literal text verbatim).
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const TOKEN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export function interpolate(
  template: string,
  data: Record<string, unknown>,
  allowed: string[],
): string {
  const allow = new Set(allowed);
  let out = '';
  let last = 0;
  for (const m of template.matchAll(TOKEN)) {
    const idx = m.index ?? 0;
    out += escapeHtml(template.slice(last, idx));
    const name = m[1];
    if (allow.has(name)) {
      const v = data[name];
      out += escapeHtml(v === undefined || v === null ? '' : String(v));
    } else {
      out += escapeHtml(m[0]);
    }
    last = idx + m[0].length;
  }
  out += escapeHtml(template.slice(last));
  return out;
}
