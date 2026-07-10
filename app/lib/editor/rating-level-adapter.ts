/**
 * Module F — adapt between the template's own `RatingLevel` schema shape and
 * the canonical `EditorLevel` shape the shared `RatingSystemEditor` authors
 * (the same editor now used by both /library/rating-systems AND
 * template-edit.tsx). Kept pure/side-effect-free so it is unit-testable
 * without mounting the editor.
 */
import type { RatingLevel } from "~/components/template/types";
import type { EditorLevel } from "~/components/RatingSystemEditor";
import { isSeverity } from "~/lib/severity";

/** Template `RatingLevel` → canonical `EditorLevel` (fills defaults for optional fields). */
export function toEditorLevel(l: RatingLevel): EditorLevel {
  return {
    id: l.id,
    abbreviation: l.abbreviation || l.label.slice(0, 3).toUpperCase(),
    label: l.label,
    color: l.color || "#6b7280",
    severity: isSeverity(l.severity) ? l.severity : "minor",
    isDefect: !!l.isDefect,
    pausesAdvance: l.pausesAdvance,
  };
}

/**
 * Canonical `EditorLevel` → template `RatingLevel`. `id` is preserved when the
 * editor kept it; new levels get a generated id since the template schema
 * requires one.
 */
export function fromEditorLevel(l: EditorLevel, i: number): RatingLevel {
  return {
    id: l.id || `L${i}_${Date.now().toString(36)}`,
    label: l.label,
    abbreviation: l.abbreviation,
    color: l.color,
    severity: l.severity,
    isDefect: l.isDefect,
    pausesAdvance: l.pausesAdvance,
  };
}
