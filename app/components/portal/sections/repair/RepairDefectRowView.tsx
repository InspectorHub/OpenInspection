/**
 * <RepairDefectRowView> — the presentation of one defect, shared by every portal
 * that shows repair items: the client repair builder (<RepairDefectRow>, which
 * wraps this with a checkbox + credit inputs) and the agent repair-items page
 * (read-only, with photos).
 *
 * Both portals show the same entity, so the layout lives here once. A caller
 * that needs a different affordance expresses it as a prop; a second row
 * component would drift, and that drift is what left photos and the item label
 * off the agent page.
 *
 * lint:ds — only `ih-*` design tokens; raw Tailwind colors are forbidden.
 */
import { m } from "~/paraglide/messages";
import { DEFECT_PHOTO_GRID_CLASS, PRINT_FIGURE_CLASS } from "../report/types";

export interface RepairDefectPhoto {
  key: string;
  /** Already resolved by the caller through ITS OWN auth path. */
  url: string;
}

export interface RepairDefectRowViewProps {
  sectionTitle: string;
  itemLabel: string;
  defectTitle: string;
  location: string | null;
  comment: string | null;
  /** A defect_categories.id or legacy seed name — a tenant custom value is kept. */
  category: string;
  /** Field-added defect (customComments.defects) rather than a template canned one. */
  isCustom?: boolean;
  /** Omitted by the client builder (its rows are text-only). */
  photos?: RepairDefectPhoto[];
}

// Resolved at call time (not module load) so paraglide's ALS locale scope is
// active. An unrecognized value is a tenant custom category: show the tenant's
// own word instead of relabeling it as one of the seeds (IA-41).
function repairCategoryLabel(category: string): string {
  switch (category) {
    case "safety":
      return m.portal_repair_category_safety();
    case "recommendation":
      return m.portal_repair_category_recommendation();
    case "maintenance":
      return m.portal_repair_category_maintenance();
    default:
      return category;
  }
}

function categoryClass(category: string): string {
  if (category === "safety") return "bg-ih-bad-bg text-ih-bad-fg";
  if (category === "maintenance") return "bg-ih-bg-muted text-ih-fg-3";
  // Recommendation and any tenant custom category share the neutral-info pill.
  return "bg-ih-info-bg text-ih-info-fg";
}

export function RepairDefectRowView({
  sectionTitle,
  itemLabel,
  defectTitle,
  location,
  comment,
  category,
  isCustom = false,
  photos,
}: RepairDefectRowViewProps) {
  // Spans throughout: the client builder nests this inside a <button>, where
  // block-level elements are invalid HTML.
  return (
    // The testid marks the SHARED region in every portal that renders a defect,
    // so cross-portal-reuse.test.tsx can compare what a reader sees without
    // also comparing each portal's own surrounding affordances (the client's
    // checkbox, the staff log's "asked for" strip).
    <span data-testid="repair-defect-view" className="flex-1 min-w-0 flex items-start gap-3">
      <span className="flex-1 min-w-0">
        {/* IA-55 — the defect's own title distinguishes two defects on one
            item; the item + section give context, and location helps a
            contractor find it. */}
        <span className="block text-[13px] font-semibold text-ih-fg-1">
          {defectTitle || itemLabel}
        </span>
        <span className="block text-[12px] text-ih-fg-3 mt-0.5">
          {itemLabel} &middot; {sectionTitle}
        </span>
        {location && (
          <span className="block text-[12px] text-ih-fg-3 mt-0.5">
            {m.repair_defect_location_prefix()} {location}
          </span>
        )}
        {comment && (
          <span className="block text-[12px] text-ih-fg-3 mt-0.5 line-clamp-2">{comment}</span>
        )}
        {photos && photos.length > 0 && (
          <span className={`mt-2 ${DEFECT_PHOTO_GRID_CLASS}`}>
            {photos.map((photo, idx) => (
              <img
                key={photo.key}
                src={photo.url}
                alt={`${defectTitle || itemLabel} — photo ${idx + 1}`}
                loading="lazy"
                className={`aspect-square w-full rounded object-cover ${PRINT_FIGURE_CLASS}`}
              />
            ))}
          </span>
        )}
      </span>
      <span className="flex items-center gap-1.5 shrink-0 ml-2">
        {isCustom && (
          <span className="inline-flex items-center h-5 px-1.5 rounded text-[10px] font-bold uppercase tracking-wide bg-ih-bg-muted text-ih-fg-2">
            {m.agent_portal_repair_inspector_added()}
          </span>
        )}
        <span
          className={`inline-flex items-center h-5 px-2 rounded text-[10px] font-bold uppercase tracking-wider ${categoryClass(category)}`}
        >
          {repairCategoryLabel(category)}
        </span>
      </span>
    </span>
  );
}
