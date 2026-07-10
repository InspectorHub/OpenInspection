import { DefectCategoryChip } from "./DefectCategoryChip";

export interface CannedCommentRowProps {
  /** Read-only title (inspection display). Omit and pass `titleSlot` for editing. */
  title?: string;
  /** Editable title (template authoring) — an <input>. Wins over `title`. */
  titleSlot?: React.ReactNode;
  /** Defect category — renders a DefectCategoryChip (ml-1.5) after the title. */
  category?: string;
  /** Authoring unification Plan-4 module K — the tenant's configured
   *  `defect_categories.color` for `category`. Forwarded to the chip's
   *  data-driven `color` prop; undefined keeps the chip's tokened fallback. */
  categoryColor?: string;
  /** Extra badge after the chip (e.g. the "custom" pill). Caller owns its margin. */
  extraBadge?: React.ReactNode;
  /** inspection: "included"; template: "editing". Drives the primary-tint shell. */
  selected?: boolean;
  /** Adds cursor-pointer + hover affordance. Default true (inspection rows). */
  interactive?: boolean;
  /** inspection: a checkbox; template: reorder handles. Rendered first. */
  leading?: React.ReactNode;
  /** inspection: photo chip lives in `children`; template: delete button. Rendered last. */
  trailing?: React.ReactNode;
  /** The body — caller owns exact typography (already-Mustache-rendered <p> or a
   *  <textarea> for authoring). Keeps each editor's body byte-identical on swap. */
  bodySlot?: React.ReactNode;
  /** Under-body extras: DefectFieldsRow + per-defect photo chip. */
  children?: React.ReactNode;
  /** Shell element. Inspection wraps a checkbox → "label"; template → "div". */
  as?: "label" | "div";
}

/** Shared presentational row for one canned entry (spec §3.2). The row body
 *  (title + category chip + body + slots) is identical across editors; callers
 *  differ only in leading/trailing/bodySlot. No data fetching, no editor state. */
export function CannedCommentRow({
  title,
  titleSlot,
  category,
  categoryColor,
  extraBadge,
  selected = false,
  interactive = true,
  leading,
  trailing,
  bodySlot,
  children,
  as = "label",
}: CannedCommentRowProps) {
  const Shell = as;
  const shellClass =
    `flex items-start gap-2.5 p-2.5 min-h-11 rounded-lg transition-colors ` +
    `${interactive ? "cursor-pointer " : ""}` +
    (selected
      ? "bg-ih-primary-tint ring-1 ring-ih-primary/30"
      : "bg-ih-bg-app/50 hover:bg-ih-bg-muted");

  return (
    <Shell className={shellClass}>
      {leading}
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-bold text-ih-fg-2">
          {titleSlot ?? title}
          {category && <DefectCategoryChip category={category} color={categoryColor} className="ml-1.5" />}
          {extraBadge}
        </div>
        {bodySlot}
        {children}
      </div>
      {trailing}
    </Shell>
  );
}
