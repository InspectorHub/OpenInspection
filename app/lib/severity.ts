import { m } from "~/paraglide/messages";

/** The single severity vocabulary shared by rating levels AND comments (spec §4.F, §9 #1). */
export type Severity = 'good' | 'marginal' | 'significant' | 'minor';

export const SEVERITIES: readonly Severity[] = ['good', 'marginal', 'significant', 'minor'];

/**
 * Display-only friendly labels. Severity is the stored word; these are shown read-only.
 * Labels are exposed as getters so the string resolves at access time (under the active
 * paraglide locale), not frozen at module-import time.
 */
export const SEVERITY_LABEL: Record<Severity, string> = {
  get good() { return m.label_severity_good(); },
  get marginal() { return m.label_severity_marginal(); },
  get significant() { return m.label_severity_significant(); },
  get minor() { return m.label_severity_minor(); },
};

/** DS-0523 status-dot class per severity. */
export const SEVERITY_DOT: Record<Severity, string> = {
  good: 'bg-ih-ok',
  marginal: 'bg-ih-watch',
  significant: 'bg-ih-bad',
  minor: 'bg-ih-fg-4',
};

export function isSeverity(v: unknown): v is Severity {
  return typeof v === 'string' && (SEVERITIES as readonly string[]).includes(v);
}
