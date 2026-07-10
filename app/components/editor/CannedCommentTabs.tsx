import { TabStrip } from "@core/shared-ui";
import { CannedCommentRow } from "../editor-shared/CannedCommentRow";
import { DefectFieldsRow, type DefectFieldsValue } from "./DefectFieldsRow";
import { RepairItemsPanel } from "./RepairItemsPanel";
import { CustomDefectForm } from "./CustomDefectForm";
import type { AttachedRepairItem } from "../../hooks/useFindings";
import { renderTemplate } from "../../lib/mustache";
import {
  DEFECT_TRADE_LABELS,
  DEFECT_DEADLINE_LABELS,
  DEFECT_TIMEFRAME_LABELS,
} from "../../lib/defect-fields";
import type { CustomDefect, CustomDefectCategory } from "../../lib/custom-defects";

/* ------------------------------------------------------------------ */
/* Canned comment types */
/* ------------------------------------------------------------------ */

export interface CannedInfoComment {
  id: string;
  title: string;
  comment: string;
  default: boolean;
}

export interface CannedDefect {
  id: string;
  title: string;
  category: string;
  location: string;
  comment: string;
  photos: string[];
  default: boolean;
}

/** Track H — a tenant-library search hit (shape mirrors CommentEntry in
 *  useCannedComments; kept structural so this component stays hook-free). */
export interface LibraryMatch {
  id?: string;
  text: string;
  severity: string;
  category?: string | null;
  section?: string | null;
}

export type CannedTabId = "information" | "limitations" | "defects";

export interface CannedCommentTabsProps {
  visibleTabs: Array<{ id: CannedTabId; label: string; count?: number }>;
  activeTab: CannedTabId;
  onChangeTab: (id: CannedTabId) => void;

  /** All raw entries for the active tab (pre-search-filter). */
  rawTabEntries: Array<CannedInfoComment | CannedDefect>;
  /** Entries for the active tab after the Defects-tab search filter. */
  currentTabEntries: Array<CannedInfoComment | CannedDefect>;
  /** Included canned IDs for the active tab. */
  includedSet: Set<string>;

  defectQuery: string;
  onDefectQueryChange: (value: string) => void;

  /** result.attributes — Mustache vars for canned-comment prose. */
  resultAttributes: Record<string, unknown> | undefined;

  onToggleCanned?: (tabName: string, cannedId: string, included: boolean) => void;
  defectStates?: Map<string, DefectFieldsValue>;
  locationSuggestions?: string[];
  onDefectFields?: (cannedId: string, patch: Partial<DefectFieldsValue>) => void;
  missingFields?: Map<string, { location: boolean; trade: boolean }>;
  requiredDefectFields?: { location: boolean; trade: boolean };

  /** Renders the per-defect "add photo" chip (closes over onAddDefectPhoto/photoUploading). */
  defectPhotoChip: (target: { kind: "canned" | "custom"; id: string }, count: number) => React.ReactNode;
  /** Photo count on a canned defect's STATE row. */
  cannedDefectPhotoCount: (cannedId: string) => number;

  /** Authoring unification Plan-4 module K — one tenant-wide lookup (keyed by
   *  BOTH defect_categories.name and .id) resolving a defect's `category` to
   *  its configured color. Forwarded to every CannedCommentRow's chip so the
   *  configured color renders in the editor, not just the report. */
  categoryColor?: Map<string, string>;

  /** Track H (IA-5/迁移③) — whole-library hits under the same search box. */
  libraryMatches: LibraryMatch[];
  /** Seeds the custom-defect form from a tapped library match. */
  onSeedFromLibrary: (match: LibraryMatch) => void;

  /** Field-authored custom defects already persisted on this item. */
  customDefects: Array<CustomDefect & { photos?: Array<{ key: string }> }>;
  onToggleCustomDefect?: (customId: string, included: boolean) => void;

  /** B-20 — add a field-authored custom defect. When unset the form is hidden. */
  onAddCustomDefect?: (input: { title: string; comment: string; category: CustomDefectCategory }) => void;
  customFormOpen: boolean;
  /** Opens the custom-defect form (seeds title from query when no matches). */
  onOpenCustomForm: () => void;
  /** CustomDefectForm controlled props (state owned by ItemEditor). */
  customTitle: string;
  customComment: string;
  customCategory: CustomDefectCategory;
  saveToLibrary: boolean;
  showSaveToLibrary: boolean;
  onCustomTitleChange: (value: string) => void;
  onCustomCommentChange: (value: string) => void;
  onCustomCategoryChange: (value: CustomDefectCategory) => void;
  onSaveToLibraryChange: (value: boolean) => void;
  onCancelCustomForm: () => void;
  onSubmitCustomDefect: () => void;

  /** Task 6 — attach repair items (snapshot estimate + contractor) to this finding. */
  attachedRepairItems?: AttachedRepairItem[];
  onAttachRepairItem?: (snap: AttachedRepairItem) => void;
  onDetachRepairItem?: (recommendationId: string) => void;
}

export function CannedCommentTabs({
  visibleTabs,
  activeTab,
  onChangeTab,
  rawTabEntries,
  currentTabEntries,
  includedSet,
  defectQuery,
  onDefectQueryChange,
  resultAttributes,
  onToggleCanned,
  defectStates,
  locationSuggestions,
  onDefectFields,
  missingFields,
  requiredDefectFields,
  defectPhotoChip,
  cannedDefectPhotoCount,
  categoryColor,
  libraryMatches,
  onSeedFromLibrary,
  customDefects,
  onToggleCustomDefect,
  onAddCustomDefect,
  customFormOpen,
  onOpenCustomForm,
  customTitle,
  customComment,
  customCategory,
  saveToLibrary,
  showSaveToLibrary,
  onCustomTitleChange,
  onCustomCommentChange,
  onCustomCategoryChange,
  onSaveToLibraryChange,
  onCancelCustomForm,
  onSubmitCustomDefect,
  attachedRepairItems,
  onAttachRepairItem,
  onDetachRepairItem,
}: CannedCommentTabsProps) {
  return (
    <div>
      {/* Tab strip (shared Design System component) */}
      <div className="mb-3">
        <TabStrip
          tabs={visibleTabs}
          activeId={activeTab}
          onChange={(id) => onChangeTab(id as CannedTabId)}
        />
      </div>

      {/* B-20 — searchable defect library */}
      {activeTab === "defects" && rawTabEntries.length > 0 && (
        <input
          value={defectQuery}
          onChange={(e) => onDefectQueryChange(e.target.value)}
          placeholder="Search defects…"
          aria-label="Search defects"
          className="w-full h-9 px-3 mb-2 rounded-lg border border-ih-border bg-ih-bg-card text-[13px] focus:shadow-ih-focus focus:border-ih-primary outline-none placeholder:text-ih-fg-4"
        />
      )}

      {/* Tab content: list of canned comments with toggles */}
      <div className="space-y-1.5">
        {currentTabEntries.length === 0 ? (
          <p className="text-[13px] text-ih-fg-3 text-center py-8">
            {activeTab === "defects" && defectQuery.trim()
              ? <>No defects match “{defectQuery.trim()}” — add it as a custom defect below.</>
              : "No pre-built comments for this tab."}
          </p>
        ) : (
          currentTabEntries.map((entry) => {
            const isIncluded = includedSet.has(entry.id);
            const isDefectIncluded = activeTab === "defects" && isIncluded;
            const st = isDefectIncluded ? (defectStates?.get(entry.id) ?? {}) : null;
            const attrEntries = resultAttributes && typeof resultAttributes === "object"
              ? Object.entries(resultAttributes as Record<string, unknown>) : [];
            const attrVars: Record<string, string | null> = {};
            for (const [k, v] of attrEntries) {
              if (v === null || v === undefined) attrVars[k] = null;
              else if (typeof v === "string") attrVars[k] = v.length > 0 ? v : null;
              else if (typeof v === "number" && Number.isFinite(v)) attrVars[k] = String(v);
              else if (typeof v === "boolean") attrVars[k] = v ? "yes" : "no";
              else attrVars[k] = null;
            }
            const vars = st ? {
              location:  st.location ?? null,
              trade:     st.trade     ? DEFECT_TRADE_LABELS[st.trade]         : null,
              deadline:  st.deadline  ? DEFECT_DEADLINE_LABELS[st.deadline]   : null,
              timeframe: st.timeframe ? DEFECT_TIMEFRAME_LABELS[st.timeframe] : null,
              ...attrVars,
            } : null;
            return (
              <CannedCommentRow
                key={entry.id}
                as="label"
                selected={isIncluded}
                title={entry.title}
                category={"category" in entry ? (entry as CannedDefect).category || undefined : undefined}
                categoryColor={"category" in entry ? categoryColor?.get((entry as CannedDefect).category) : undefined}
                leading={
                  <input
                    type="checkbox"
                    checked={isIncluded}
                    onChange={() => onToggleCanned?.(activeTab, entry.id, !isIncluded)}
                    className="mt-0.5 w-4 h-4 rounded border-ih-border-strong text-ih-primary focus:ring-ih-primary/30"
                  />
                }
                bodySlot={
                  <p className={`text-[11px] mt-0.5 leading-relaxed ${isIncluded ? "text-ih-fg-3" : "text-ih-fg-4"}`}>
                    {vars ? renderTemplate(entry.comment, vars) : entry.comment}
                  </p>
                }
              >
                {isDefectIncluded && (
                  <>
                    <DefectFieldsRow
                      cannedId={entry.id}
                      value={st!}
                      locationSuggestions={locationSuggestions ?? []}
                      onChange={onDefectFields ?? (() => {})}
                      locationRequired={(requiredDefectFields?.location ?? false) || missingFields?.get(entry.id)?.location}
                      tradeRequired={(requiredDefectFields?.trade ?? false) || missingFields?.get(entry.id)?.trade}
                    />
                    {/* FE-3 — photo pinned to THIS defect, not the item */}
                    {defectPhotoChip({ kind: "canned", id: entry.id }, cannedDefectPhotoCount(entry.id))}
                  </>
                )}
              </CannedCommentRow>
            );
          })
        )}

        {/* Track H (IA-5/迁移③) — whole-library hits under the same search box.
            Tapping one SEEDS the custom-defect form (title from the first
            sentence, narrative = full text) so the inspector can edit before
            committing — a library comment is language, not a finished defect. */}
        {activeTab === "defects" && libraryMatches.length > 0 && (
          <div className="pt-1">
            <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-ih-fg-4 px-1 pb-1">
              From your library
            </div>
            <div className="space-y-1.5">
              {libraryMatches.map((m, i) => (
                <button
                  key={m.id ?? `lib-${i}`}
                  type="button"
                  onClick={() => onSeedFromLibrary(m)}
                  className="w-full text-left p-2.5 rounded-lg bg-ih-bg-app/50 hover:bg-ih-bg-muted border border-dashed border-ih-border transition-colors"
                >
                  <p className="text-[12px] leading-relaxed text-ih-fg-2 line-clamp-2">{m.text}</p>
                  <span className="text-[10px] text-ih-fg-4">
                    {m.severity !== "all" ? m.severity : "any severity"}
                    {m.section ? ` · ${m.section}` : ""} · tap to use as custom defect
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* B-20 — field-authored custom defects + inline add form */}
        {activeTab === "defects" && (
          <>
            {customDefects.map((cd) => (
              <CannedCommentRow
                key={cd.id}
                as="label"
                selected={cd.included !== false}
                title={cd.title}
                category={cd.category}
                categoryColor={categoryColor?.get(cd.category)}
                extraBadge={
                  <span className="ml-1.5 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-ih-primary-tint text-ih-primary">
                    custom
                  </span>
                }
                leading={
                  <input
                    type="checkbox"
                    checked={cd.included !== false}
                    onChange={() => onToggleCustomDefect?.(cd.id, !(cd.included !== false))}
                    className="mt-0.5 w-4 h-4 rounded border-ih-border-strong text-ih-primary focus:ring-ih-primary/30"
                  />
                }
                bodySlot={
                  cd.comment ? (
                    <p className="text-[12px] mt-0.5 leading-relaxed text-ih-fg-3">{cd.comment}</p>
                  ) : null
                }
              >
                {/* FE-3 — photo pinned to this custom defect */}
                {cd.included !== false &&
                  defectPhotoChip({ kind: "custom", id: cd.id }, Array.isArray(cd.photos) ? cd.photos.length : 0)}
              </CannedCommentRow>
            ))}

            {onAddCustomDefect && (
              customFormOpen ? (
                <CustomDefectForm
                  title={customTitle}
                  comment={customComment}
                  category={customCategory}
                  saveToLibrary={saveToLibrary}
                  showSaveToLibrary={showSaveToLibrary}
                  onTitleChange={onCustomTitleChange}
                  onCommentChange={onCustomCommentChange}
                  onCategoryChange={onCustomCategoryChange}
                  onSaveToLibraryChange={onSaveToLibraryChange}
                  onCancel={onCancelCustomForm}
                  onSubmit={onSubmitCustomDefect}
                />
              ) : (
                <button
                  type="button"
                  onClick={onOpenCustomForm}
                  className="w-full p-2.5 rounded-lg border border-dashed border-ih-border-strong text-[12px] font-bold text-ih-fg-3 hover:border-ih-primary hover:text-ih-primary transition-colors text-left"
                >
                  + Add custom defect
                </button>
              )
            )}
          </>
        )}

        {/* Task 6 — attach repair items (snapshot estimate + contractor) to this
            finding. Only on the Defects tab; only when the parent wires the callbacks. */}
        {activeTab === "defects" && onAttachRepairItem && onDetachRepairItem && (
          <RepairItemsPanel
            attached={attachedRepairItems ?? []}
            onAttach={onAttachRepairItem}
            onDetach={onDetachRepairItem}
          />
        )}
      </div>
    </div>
  );
}
