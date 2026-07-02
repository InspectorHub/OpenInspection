export interface DefectCategoryChipProps {
  /** 'safety' | 'recommendation' | 'maintenance'. Raw strings are tolerated:
   *  the inspection canned-defect `category` is a free-form schema string, and
   *  anything unrecognised falls back to the muted styling (spec §3.1). */
  category: string;
  /** Optional extra classes — e.g. `ml-1.5` for the inline-after-title margin. */
  className?: string;
}

/** Single source of truth for defect-category pill styling (spec §3.1).
 *  Replaces the two inline copies in CannedCommentTabs and the SideRail pill. */
const CATEGORY_TOKENS: Record<string, string> = {
  safety: "bg-ih-bad-bg text-ih-bad-fg",
  recommendation: "bg-ih-watch-bg text-ih-watch-fg",
};
// Canonical "other"/maintenance styling. Converges the prior drift
// (canned used text-ih-fg-3, custom used text-ih-fg-2) onto fg-3.
const DEFAULT_TOKENS = "bg-ih-bg-muted text-ih-fg-3";

export function DefectCategoryChip({ category, className }: DefectCategoryChipProps) {
  const tokens = CATEGORY_TOKENS[category] ?? DEFAULT_TOKENS;
  return (
    <span
      className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${tokens}${
        className ? ` ${className}` : ""
      }`}
    >
      {category}
    </span>
  );
}
