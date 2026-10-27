import type { CSSProperties } from "react";
import { isFallbackRatingColor, safeCssColor } from "../../lib/readable-text";

/** The class for a rating this list knows by name; anything else is neutral. */
function ratingDotClass(rating: string): string {
  if (rating === "Satisfactory" || rating === "SAT") return "bg-ih-ok";
  if (rating === "Monitor" || rating === "MON") return "bg-ih-watch";
  if (rating === "Defect" || rating === "DEF") return "bg-ih-bad";
  return "bg-ih-border-strong";
}

/**
 * The dot beside an item: the rating's own colour when the editor has one (a tenant's level colour, whatever its id),
 * otherwise the class for the ids it knows by name. The fallback token means "no colour of its own", so it is not painted.
 */
export function ratingDot(rating: string, getRatingColor?: (id: string) => string): { className: string; style?: CSSProperties } {
  const color = safeCssColor(getRatingColor?.(rating));
  if (color && !isFallbackRatingColor(color)) return { className: "", style: { background: color } };
  return { className: ratingDotClass(rating) };
}
