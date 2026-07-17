import type { EditorRatingLevel } from "../../lib/rating-levels";
import { RatingSegment, type RatingOption, type RatingTone } from "../editor-shared/RatingSegment";
import { m } from "~/paraglide/messages";

/* Severity → RatingSegment tone. `good`/`marginal`/`significant` map to the
 * ok/warn/bad tone tokens (readable in direct sunlight per field eval
 * FE/C-14a); any other severity — including the pre-migration `minor` tier's
 * inverse-fill treatment, or an absent severity — falls back to `neutral`,
 * mirroring the old SEVERITY_STYLES[r.severity ?? "minor"] ?? .minor default. */
const SEVERITY_TONE: Record<string, RatingTone> = {
  good: "ok",
  marginal: "warn",
  significant: "bad",
};

function toneFor(severity: string | undefined): RatingTone {
  return SEVERITY_TONE[severity ?? ""] ?? "neutral";
}

export interface RatingButtonRowProps {
  levels: EditorRatingLevel[];
  activeLevel: EditorRatingLevel | null | undefined;
  onRating: (rating: string) => void;
}

/* Rating buttons — driven by the rating system's levels (C-14a). Delegates to
   the shared RatingSegment radiogroup (consolidates the hand-rolled tile
   copies across RatingButtonRow/BatchActionBar/SpeedMode). Same rating
   `value`s (level `id`) and `onRating` callback as before; now carries
   radiogroup a11y semantics (role="radio"/aria-checked + roving tabindex +
   Arrow/Home/End key support) in place of the former plain-button +
   aria-pressed markup. */
export function RatingButtonRow({ levels, activeLevel, onRating }: RatingButtonRowProps) {
  const ratings: RatingOption[] = levels.map((r, idx) => {
    const full = r.label ?? r.name ?? r.id;
    return {
      value: r.id,
      label: full,
      shortLabel: r.abbreviation ?? full,
      tone: toneFor(r.severity),
      hint: String(idx + 1),
    };
  });

  return (
    // FE-4 — gap-3 (12px) between rating buttons: adjacent mis-taps were the
    // top field complaint. Single row (no wrap), same as the pre-migration
    // flex-1 tile row.
    <div data-shortcut-scope>
      <RatingSegment
        ratings={ratings}
        value={activeLevel?.id ?? null}
        onChange={onRating}
        ariaLabel={m.editor_rating_aria()}
        className="flex-nowrap gap-3"
      />
    </div>
  );
}
