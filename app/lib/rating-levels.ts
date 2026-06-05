/**
 * B-18 — rating-level lookup + auto-advance policy.
 *
 * The editor stores whatever the rating buttons emit; historically the
 * desktop panel hardcoded 'SAT'/'MON'/'DEF' while rating-system levels carry
 * ids like 'Defect', so `levels.find(l => l.id === rating)` never matched and
 * the seeds' `pausesAdvance` intent (Defect/Monitor stop for notes) was dead.
 * `findRatingLevel` tolerates id / abbreviation / label, case-insensitive,
 * plus prefix matches so legacy stored abbreviations keep resolving.
 *
 * `ratingAdvanceDecision` centralises when rating an item moves to the next
 * one: pausing levels never advance (rate → describe → photo stays put), and
 * pointer clicks only advance in the explicit 'always' mode — keyboard 1-5 is
 * the speed-scan path, mouse/touch is the deliberate-editing path.
 */

export interface EditorRatingLevel {
  id: string;
  label?: string;
  name?: string;
  abbreviation?: string;
  color?: string;
  severity?: string;
  isDefect?: boolean;
  pausesAdvance?: boolean;
}

export type AutoAdvanceMode = 'always' | 'keyboard' | 'off';

export function findRatingLevel<T extends EditorRatingLevel>(
  levels: readonly T[],
  value: string | null | undefined,
): T | undefined {
  if (!value) return undefined;
  const v = value.trim().toLowerCase();
  if (!v) return undefined;

  const fields = (l: T) => [l.id, l.abbreviation, l.label, l.name];

  // Exact (case-insensitive) match on id, abbreviation, label or name.
  for (const l of levels) {
    if (fields(l).some((f) => typeof f === 'string' && f.toLowerCase() === v)) return l;
  }
  // Prefix match either way ('DEF' ↔ 'Defect', 'Sat' ↔ 'SAT') — keeps legacy
  // stored abbreviations resolving against full-word levels and vice versa.
  for (const l of levels) {
    if (
      fields(l).some(
        (f) =>
          typeof f === 'string' &&
          f.length >= 2 &&
          v.length >= 2 &&
          (f.toLowerCase().startsWith(v) || v.startsWith(f.toLowerCase())),
      )
    ) {
      return l;
    }
  }
  return undefined;
}

export interface AdvanceDecision {
  advance: boolean;
  focusNotes: boolean;
}

export function ratingAdvanceDecision(opts: {
  source: 'pointer' | 'keyboard';
  level: EditorRatingLevel | undefined;
  mode: AutoAdvanceMode;
}): AdvanceDecision {
  if (opts.level?.pausesAdvance) return { advance: false, focusNotes: true };
  if (opts.mode === 'off') return { advance: false, focusNotes: false };
  if (opts.mode === 'keyboard') {
    return { advance: opts.source === 'keyboard', focusNotes: false };
  }
  return { advance: true, focusNotes: false };
}
