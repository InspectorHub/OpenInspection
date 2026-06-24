import { useState, useMemo, useEffect } from "react";
import { CloneLastButton } from "./CloneLastButton";
import { type DefectFieldsValue } from "./DefectFieldsRow";
import { ItemAttributesPanel } from "./ItemAttributesPanel";
import { RatingButtonRow } from "./RatingButtonRow";
import {
 CannedCommentTabs,
 type CannedInfoComment,
 type CannedDefect,
 type CannedTabId,
 type LibraryMatch,
} from "./CannedCommentTabs";
import { ItemPhotoStrip, type StripPhoto } from "../media-studio/ItemPhotoStrip";
import type { AttachedRepairItem } from "../../hooks/useFindings";
import type { ItemAttribute } from "../../lib/types";
import { shouldTriggerSlash } from "../../lib/slash-trigger";
import { findRatingLevel, type EditorRatingLevel } from "../../lib/rating-levels";
import { findRatingContradictions } from "../../lib/contradiction-lint";
import { filterCannedEntries, deriveDefectTitle, type CustomDefect, type CustomDefectCategory } from "../../lib/custom-defects";

export type { LibraryMatch };

/* C-14a — rating buttons render from the inspection's rating-system levels
 * (full words + always-on semantic colour). The hardcoded SAT/MON/DEF row
 * wrote ids the rest of the editor (bucketForRatingId, getRatingColor,
 * pausesAdvance lookup) could never match. This fallback only covers the
 * no-levels edge and mirrors the server's fallback ids. */
const FALLBACK_LEVELS: EditorRatingLevel[] = [
 { id: "Satisfactory", label: "Satisfactory", abbreviation: "Sat", severity: "good" },
 { id: "Monitor", label: "Monitor", abbreviation: "Mon", severity: "marginal", pausesAdvance: true },
 { id: "Defect", label: "Defect", abbreviation: "Def", severity: "significant", isDefect: true, pausesAdvance: true },
 { id: "Not Inspected", label: "Not Inspected", abbreviation: "N/I", severity: "minor" },
 { id: "Not Present", label: "Not Present", abbreviation: "N/P", severity: "minor" },
];

/* ------------------------------------------------------------------ */
/* Canned comment types */
/* ------------------------------------------------------------------ */

interface ItemTabs {
 information?: CannedInfoComment[];
 limitations?: CannedInfoComment[];
 defects?: CannedDefect[];
}

const CANNED_TABS: Array<{ id: CannedTabId; label: string }> = [
 { id: "information", label: "Information" },
 { id: "limitations", label: "Limitations" },
 { id: "defects", label: "Defects" },
];

/* ------------------------------------------------------------------ */
/* Props */
/* ------------------------------------------------------------------ */

interface ItemEditorProps {
 item: { id: string; label: string; type: string; tabs?: unknown; attributes?: ItemAttribute[] } | undefined;
 sectionTitle: string | undefined;
 result: Record<string, unknown>;
 /** Rating-system levels for this inspection; falls back to the standard five. */
 ratingLevels?: EditorRatingLevel[];
 onRating: (rating: string) => void;
 onNotes: (notes: string) => void;
 onNotesBlur: (notes: string) => void;
 onToggleCanned?: (tabName: string, cannedId: string, included: boolean) => void;
 /** FE-2 — opens the photo picker (the button was previously unwired). */
 onAddPhoto?: () => void;
 photoUploading?: boolean;
 /** B-20 — add a field-authored defect into result.customComments.defects. */
 onAddCustomDefect?: (input: { title: string; comment: string; category: CustomDefectCategory }) => void;
 /** Track H (B-20 回流) — save the custom defect into the tenant library
  *  (best-effort; failure must not block the defect itself). */
 onSaveDefectToLibrary?: (input: { title: string; comment: string; category: CustomDefectCategory }) => void;
 onToggleCustomDefect?: (customId: string, included: boolean) => void;
 /** FE-3 — open the photo picker targeting a specific defect row. */
 onAddDefectPhoto?: (target: { kind: "canned" | "custom"; id: string }) => void;
 defectStates?: Map<string, DefectFieldsValue>;
 locationSuggestions?: string[];
 onDefectFields?: (cannedId: string, patch: Partial<DefectFieldsValue>) => void;
 missingFields?: Map<string, { location: boolean; trade: boolean }>;
 /** Track H (IA-7) — the EFFECTIVE tenant/inspection policy: which defect
  *  fields are required at publish. Drives the proactive red asterisk on
  *  every defect row (missingFields still unions in post-gate flags). */
 requiredDefectFields?: { location: boolean; trade: boolean };
 onItemAttribute?: (itemId: string, attributeId: string, value: string | number | boolean | null) => void;
 onCloneLast?: (scope: 'rating' | 'rating_notes' | 'all') => void;
 cloneDefaultScope?: 'rating' | 'rating_notes' | 'all';
 tagChipRow?: React.ReactNode;
 /** B-19b — called when "/" is typed at a line/word start in the notes field. */
 onOpenSnippets?: () => void;
 /** Track H (IA-5/迁移③) — searches the whole tenant comment library
  *  (incl. imported libraries); powers the "From your library" group under
  *  the Defects-tab search. */
 onSearchLibrary?: (query: string) => Promise<LibraryMatch[]>;
 /**
  * Task 4 — local blob previews for photos queued while offline.
  * Rendered in the photo strip after confirmed server photos.
  */
 queuedPreviews?: Array<{ name: string; objectUrl: string }>;
 /** Task 6 — repair items already snapshotted onto this finding. */
 attachedRepairItems?: AttachedRepairItem[];
 /** Task 6 — attach a repair item to this item (snapshots estimate + contractor). */
 onAttachRepairItem?: (itemId: string, snap: AttachedRepairItem) => void;
 /** Task 6 — detach a repair item from this item by recommendationId. */
 onDetachRepairItem?: (itemId: string, recommendationId: string) => void;
 /** Task 8 — the inspection id; used to build per-photo thumbnail URLs. */
 inspectionId?: string;
 /** Task 8 — the inspection's report-cover key, so the strip rings the cover thumb. */
 coverKey?: string | null;
 /** Task 8 — open the unified MediaViewer for this item at photo index `i`. */
 onOpenPhoto?: (itemId: string, index: number) => void;
 /** Task 8 — persist a new photo order. CONTRACT: `order` is the ORIGINAL key order. */
 onReorderPhotos?: (itemId: string, order: string[]) => void;
 /** Task 9 — bulk-detach the given photoIndex set (strip emits indices high→low). */
 onBulkDetachPhotos?: (itemId: string, indices: number[]) => void;
 /** Task 9b — the OTHER items this item's photos can be moved to. */
 moveTargets?: Array<{ itemId: string; label: string; sectionId?: string }>;
 /** Task 9b — bulk-move the given photoIndex set (high→low) to a target item. */
 onBulkMovePhotos?: (itemId: string, indices: number[], to: { itemId: string; sectionId?: string }) => void;
 /** Plan 7 — resolve a Stream poster URL for a video strip thumbnail (fail-closed → null). */
 videoPosterUrl?: (streamUid: string, posterPct?: number) => string | null;
 /** #181 PR-G — resolve the local blob URL for a pending (offline) photo entry. */
 pendingPhotoUrl?: (pendingId: string) => string | undefined;
}

/* ------------------------------------------------------------------ */
/* Component */
/* ------------------------------------------------------------------ */

export function ItemEditor({
 item,
 sectionTitle,
 result,
 ratingLevels,
 onRating,
 onNotes,
 onNotesBlur,
 onToggleCanned,
 onAddPhoto,
 onAddDefectPhoto,
 photoUploading,
 onAddCustomDefect,
 onToggleCustomDefect,
 defectStates,
 locationSuggestions,
 onDefectFields,
 missingFields,
 requiredDefectFields,
 onItemAttribute,
 onCloneLast,
 cloneDefaultScope,
 tagChipRow,
 onOpenSnippets,
 onSearchLibrary,
 onSaveDefectToLibrary,
 queuedPreviews,
 attachedRepairItems,
 onAttachRepairItem,
 onDetachRepairItem,
 inspectionId,
 coverKey,
 onOpenPhoto,
 onReorderPhotos,
 onBulkDetachPhotos,
 moveTargets,
 onBulkMovePhotos,
 videoPosterUrl,
 pendingPhotoUrl,
}: ItemEditorProps) {
 const [activeTab, setActiveTab] = useState<CannedTabId>("information");
 const [defectQuery, setDefectQuery] = useState("");
 const [customFormOpen, setCustomFormOpen] = useState(false);
 const [customTitle, setCustomTitle] = useState("");
 const [customComment, setCustomComment] = useState("");
 const [customCategory, setCustomCategory] = useState<CustomDefectCategory>("recommendation");
 const [saveToLibrary, setSaveToLibrary] = useState(false);

 // Track H (IA-5/迁移③) — debounced whole-library search behind the Defects
 // tab search box. Defect-bucket hits sort first; imported-library rows
 // participate (that's the migration selling point — years of accumulated
 // language come along).
 const [libraryMatches, setLibraryMatches] = useState<LibraryMatch[]>([]);
 useEffect(() => {
 const q = defectQuery.trim();
 if (activeTab !== "defects" || q.length < 2 || !onSearchLibrary) {
 setLibraryMatches([]);
 return;
 }
 let cancelled = false;
 const t = setTimeout(() => {
 onSearchLibrary(q).then((rows) => {
 if (cancelled) return;
 const ranked = [...rows].sort((a, b) =>
 (a.rating === "defect" ? 0 : 1) - (b.rating === "defect" ? 0 : 1));
 setLibraryMatches(ranked.slice(0, 6));
 }).catch(() => { /* search is best-effort */ });
 }, 250);
 return () => { cancelled = true; clearTimeout(t); };
 }, [defectQuery, activeTab, onSearchLibrary]);

 if (!item) return null;

 const tabs = (item.tabs || {}) as ItemTabs;
 const hasTabs = item.type === "rich" && tabs && (
 (tabs.information && tabs.information.length > 0) ||
 (tabs.limitations && tabs.limitations.length > 0) ||
 (tabs.defects && tabs.defects.length > 0)
 );

 // Build a set of included canned IDs from the result state.
 // The result may store canned state as `result.tabs[tabName]` (array of { cannedId, included }).
 const getIncludedSet = (tabName: CannedTabId): Set<string> => {
 const included = new Set<string>();
 const templateEntries = (tabs[tabName] || []) as Array<{ id: string; default: boolean }>;
 const stateEntries = ((result.tabs as Record<string, Array<{ cannedId: string; included: boolean }>> | undefined)?.[tabName]) || [];
 const stateMap = new Map<string, boolean>();
 for (const s of stateEntries) {
 stateMap.set(s.cannedId, s.included);
 }
 for (const entry of templateEntries) {
 const stateVal = stateMap.get(entry.id);
 // If there is a state override, use it; otherwise use the template default
 const isIncluded = stateVal !== undefined ? stateVal : entry.default;
 if (isIncluded) included.add(entry.id);
 }
 return included;
 };

 const rawTabEntries = (tabs[activeTab] || []) as Array<CannedInfoComment | CannedDefect>;
 // B-20: the Defects tab is searchable — canned libraries grow long and the
 // inspector is hunting for "water stain" with one thumb on a roof.
 const currentTabEntries =
 activeTab === "defects" && defectQuery.trim()
 ? filterCannedEntries(rawTabEntries, defectQuery)
 : rawTabEntries;
 const includedSet = getIncludedSet(activeTab);

 const levels = ratingLevels && ratingLevels.length > 0 ? ratingLevels : FALLBACK_LEVELS;
 // Normalised lookup: legacy stored values ('DEF') resolve onto the system's
 // level ('Defect'), so highlights survive the id-scheme split (B-18).
 const activeLevel = findRatingLevel(levels, (result.rating as string) || null);

 // C-14b — included "all clear" narratives that contradict a Defect/Monitor
 // rating (e.g. the pre-checked "no visible defects" Condition line).
 const lintEntries = ([
 ...((tabs.information || []).map((e) => ({ ...e, tab: "information" as const }))),
 ...((tabs.limitations || []).map((e) => ({ ...e, tab: "limitations" as const }))),
 ]);
 const lintIncluded = new Set([
 ...getIncludedSet("information"),
 ...getIncludedSet("limitations"),
 ]);
 const contradictions = hasTabs
 ? findRatingContradictions({ level: activeLevel, entries: lintEntries, includedIds: lintIncluded })
  .map((hit) => hit as typeof hit & { tab: "information" | "limitations" })
 : [];

 // B-20 — field-authored custom defects already persisted on this item.
 const customDefects = (((result.customComments as { defects?: (CustomDefect & { photos?: Array<{ key: string }> })[] } | undefined)?.defects) ?? []);

 // FE-3 — photo count on a canned defect's STATE row (tabs.defects[].photos).
 const cannedDefectPhotoCount = (cannedId: string): number => {
 const rows = ((result.tabs as { defects?: Array<{ cannedId: string; photos?: unknown[] }> } | undefined)?.defects) ?? [];
 const row = Array.isArray(rows) ? rows.find((r) => r.cannedId === cannedId) : undefined;
 return Array.isArray(row?.photos) ? row.photos.length : 0;
 };

 // Shared per-defect photo chip (canned + custom rows).
 const defectPhotoChip = (target: { kind: "canned" | "custom"; id: string }, count: number) =>
 onAddDefectPhoto ? (
 <button
 type="button"
 onClick={(e) => {
 e.preventDefault();
 e.stopPropagation();
 onAddDefectPhoto(target);
 }}
 disabled={photoUploading}
 aria-label="Add photo to this defect"
 className="inline-flex items-center gap-1 mt-1.5 px-2 py-1 rounded-md border border-dashed border-ih-border-strong text-[11px] font-bold text-ih-fg-3 hover:border-ih-primary hover:text-ih-primary transition-colors disabled:opacity-50"
 >
 <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
 </svg>
 {count > 0 ? `${count} photo${count === 1 ? "" : "s"} · add` : "Add photo"}
 </button>
 ) : null;

 const submitCustomDefect = () => {
 const title = customTitle.trim();
 if (!title || !onAddCustomDefect) return;
 onAddCustomDefect({ title, comment: customComment.trim(), category: customCategory });
 // Track H (B-20 回流) — optionally flow the field-authored defect back into
 // the tenant library so the next inspection finds it in search. Best-effort:
 // library save failure must never block the defect itself (parent toasts).
 if (saveToLibrary && onSaveDefectToLibrary) {
 onSaveDefectToLibrary({ title, comment: customComment.trim(), category: customCategory });
 }
 setCustomTitle("");
 setCustomComment("");
 setCustomCategory("recommendation");
 setSaveToLibrary(false);
 setCustomFormOpen(false);
 };

 // Build visible tabs for shared TabStrip (only tabs with entries)
 const visibleTabs = useMemo(() =>
 CANNED_TABS
  .filter((tab) => ((tabs[tab.id] || []) as unknown[]).length > 0)
  .map((tab) => ({ id: tab.id, label: tab.label, count: getIncludedSet(tab.id).size || undefined })),
 [tabs, result]);

 // Photo count is read in several places (badge, caption, empty-state copy).
 const photoCount = ((result.photos as unknown[]) || []).length;
 const queuedCount = queuedPreviews?.length ?? 0;

 // Photo-strip status line (uploading / empty / counts).
 let photoStatus: string;
 if (photoUploading) {
 photoStatus = "Uploading…";
 } else if (photoCount === 0 && queuedCount === 0) {
 photoStatus = "No photos yet";
 } else {
 const queuedSuffix = queuedCount > 0 ? ` · ${queuedCount} queued` : "";
 photoStatus = `${photoCount} photo${photoCount === 1 ? "" : "s"}${queuedSuffix}`;
 }

 return (
 <div className="max-w-2xl space-y-6">
 {/* Eyebrow + title */}
 <div>
 <div className="text-[11px] text-ih-primary font-bold uppercase tracking-wide">
 {sectionTitle}
 </div>
 <h2 className="text-[19px] font-bold mt-1">{item.label}</h2>
 </div>

 {/* Item attributes (equipment fields: brand, year, model, etc.) */}
 {item.attributes && item.attributes.length > 0 && (
 <ItemAttributesPanel
 itemId={item.id}
 attributes={item.attributes}
 values={(result.attributes as Record<string, string | number | boolean | null>) ?? {}}
 onChange={onItemAttribute ?? (() => {})}
 />
 )}

 {/* Clone last button */}
 {item.type === "rich" && onCloneLast && (
 <div className="flex justify-end mb-1">
 <CloneLastButton
 defaultScope={cloneDefaultScope ?? 'rating_notes'}
 onClone={onCloneLast}
 />
 </div>
 )}

 {/* Rating buttons — driven by the rating system's levels (C-14a):
 full words on ≥sm, abbreviation on narrow, always-on semantic colour. */}
 {item.type === "rich" && (
 <RatingButtonRow levels={levels} activeLevel={activeLevel} onRating={onRating} />
 )}

 {/* C-14b — contradiction lint: the rating says defect/monitor while an
 included canned narrative still claims "no visible defects". */}
 {contradictions.length > 0 && (
 <div className="rounded-lg border border-ih-watch/40 bg-ih-watch-bg px-3 py-2">
 <p className="text-[12px] font-bold text-ih-watch-fg">
 Rating contradicts {contradictions.length === 1 ? "a checked comment" : `${contradictions.length} checked comments`}
 </p>
 <ul className="mt-1 space-y-1">
 {contradictions.map((hit) => (
 <li key={hit.id} className="flex items-center justify-between gap-2 text-[12px] text-ih-watch-fg">
 <span className="truncate">“{hit.title}” still says all-clear</span>
 <button
 type="button"
 onClick={() => onToggleCanned?.(hit.tab, hit.id, false)}
 className="shrink-0 text-[11px] font-bold underline decoration-ih-watch hover:text-ih-fg-1"
 >
 Uncheck it
 </button>
 </li>
 ))}
 </ul>
 </div>
 )}

 {/* Notes textarea with character count */}
 <div>
 <div className="flex items-center justify-between mb-1">
 <label className="text-[11px] font-bold uppercase tracking-wide text-ih-fg-4">
 Notes
 </label>
 <span className={`text-[10px] font-mono tabular-nums ${
 ((result.notes as string) || "").length > 2000
 ? "text-ih-bad-fg"
 : "text-ih-fg-4"
 }`}>
 {((result.notes as string) || "").length} chars
 </span>
 </div>
 <textarea
 id="notes-textarea"
 value={(result.notes as string) || ""}
 onChange={(e) => onNotes(e.target.value)}
 onBlur={(e) => onNotesBlur(e.target.value)}
 onKeyDown={(e) => {
  if (
   e.key === '/' &&
   !e.nativeEvent.isComposing &&
   shouldTriggerSlash(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)
  ) {
   e.preventDefault();
   onOpenSnippets?.();
  }
 }}
 placeholder="Add notes — type / for snippets"
 className="w-full h-28 px-3 py-2 rounded-lg border border-ih-border bg-ih-bg-card text-[13px] resize-none focus:shadow-ih-focus focus:border-ih-primary outline-none"
 />
 {tagChipRow}
 </div>

 {/* Canned comments tabs */}
 {hasTabs && (
 <CannedCommentTabs
 visibleTabs={visibleTabs}
 activeTab={activeTab}
 onChangeTab={setActiveTab}
 rawTabEntries={rawTabEntries}
 currentTabEntries={currentTabEntries}
 includedSet={includedSet}
 defectQuery={defectQuery}
 onDefectQueryChange={setDefectQuery}
 resultAttributes={result.attributes as Record<string, unknown> | undefined}
 onToggleCanned={onToggleCanned}
 defectStates={defectStates}
 locationSuggestions={locationSuggestions}
 onDefectFields={onDefectFields}
 missingFields={missingFields}
 requiredDefectFields={requiredDefectFields}
 defectPhotoChip={defectPhotoChip}
 cannedDefectPhotoCount={cannedDefectPhotoCount}
 libraryMatches={libraryMatches}
 onSeedFromLibrary={(m) => {
  setCustomTitle(deriveDefectTitle(m.text));
  setCustomComment(m.text);
  setCustomCategory("recommendation");
  setCustomFormOpen(true);
 }}
 customDefects={customDefects}
 onToggleCustomDefect={onToggleCustomDefect}
 onAddCustomDefect={onAddCustomDefect}
 customFormOpen={customFormOpen}
 onOpenCustomForm={() => {
  if (defectQuery.trim() && currentTabEntries.length === 0) {
   setCustomTitle(defectQuery.trim());
  }
  setCustomFormOpen(true);
 }}
 customTitle={customTitle}
 customComment={customComment}
 customCategory={customCategory}
 saveToLibrary={saveToLibrary}
 showSaveToLibrary={!!onSaveDefectToLibrary}
 onCustomTitleChange={setCustomTitle}
 onCustomCommentChange={setCustomComment}
 onCustomCategoryChange={setCustomCategory}
 onSaveToLibraryChange={setSaveToLibrary}
 onCancelCustomForm={() => setCustomFormOpen(false)}
 onSubmitCustomDefect={submitCustomDefect}
 attachedRepairItems={attachedRepairItems}
 onAttachRepairItem={onAttachRepairItem ? (snap) => onAttachRepairItem(item.id, snap) : undefined}
 onDetachRepairItem={onDetachRepairItem ? (rid) => onDetachRepairItem(item.id, rid) : undefined}
 />
 )}

 {/* Photo strip with count badge */}
 <div>
 <div className="flex items-center justify-between mb-1">
 <label className="text-[11px] font-bold uppercase tracking-wide text-ih-fg-4">
 Photos
 </label>
 {photoCount > 0 && (
 <span className="inline-flex items-center gap-1 text-[10px] font-bold text-ih-primary bg-ih-primary-tint px-1.5 py-0.5 rounded">
 <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
 </svg>
 {photoCount}
 </span>
 )}
 </div>
 {/* Task 8 — visible thumbnail strip (edited derivative as the face) +
 cover ring + add tile + tap-to-viewer + long-press reorder; Task 9 adds
 Drive-style multi-select bulk detach. Replaces the old bare Add button. */}
 <ItemPhotoStrip
 inspectionId={inspectionId ?? ""}
 itemId={item.id}
 photos={((result.photos as StripPhoto[]) ?? [])}
 coverKey={coverKey ?? null}
 photoUrl={(k) => `/api/inspections/${inspectionId}/photo?key=${encodeURIComponent(k)}`}
 onAddPhoto={() => onAddPhoto?.()}
 onOpen={(i) => onOpenPhoto?.(item.id, i)}
 onReorder={onReorderPhotos ? (order) => onReorderPhotos(item.id, order) : undefined}
 selectable={!!onBulkDetachPhotos || !!onBulkMovePhotos}
 onBulkDetach={onBulkDetachPhotos ? (indices) => onBulkDetachPhotos(item.id, indices) : undefined}
 moveTargets={moveTargets ? moveTargets.filter((m) => m.itemId !== item.id) : undefined}
 onBulkMove={onBulkMovePhotos ? (indices, to) => onBulkMovePhotos(item.id, indices, to) : undefined}
 photoUploading={photoUploading}
 videoPosterUrl={videoPosterUrl}
 pendingPhotoUrl={pendingPhotoUrl}
 />
 {/* Task 4 — queued offline photo previews rendered below the strip */}
 {queuedCount > 0 && (
 <div className="flex flex-wrap items-center gap-2 mt-2">
 {(queuedPreviews ?? []).map((preview) => (
 <div key={preview.objectUrl} className="relative w-16 h-16 rounded-lg overflow-hidden border border-ih-border flex-shrink-0">
  <img
  src={preview.objectUrl}
  alt={preview.name}
  className="w-full h-full object-cover opacity-70"
  />
  <span className="absolute bottom-0 left-0 right-0 flex justify-center pb-0.5">
  <span className="text-[9px] font-bold uppercase bg-ih-watch-bg text-ih-watch-fg rounded px-1">
   QUEUED
  </span>
  </span>
 </div>
 ))}
 </div>
 )}
 <span className="block mt-1 text-[12px] text-ih-fg-4">
 {photoStatus}
 </span>
 </div>
 </div>
 );
}
