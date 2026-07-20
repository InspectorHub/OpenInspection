import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useLoaderData, useFetcher, useNavigate, useRevalidator } from "react-router";
import { findRatingLevel, ratingAdvanceDecision } from "~/lib/rating-levels";
import { makeCustomDefect } from "~/lib/custom-defects";
import { useInspectionState, type InspectionSchema, type ItemFilter } from "~/hooks/useInspection";
import { findingKey } from "~/hooks/findings/shared";
import { useDisplayLocale } from "~/hooks/useSessionContext";
import { useFindings, type AttachedRepairItem } from "~/hooks/useFindings";
import { usePhotoOps } from "~/hooks/usePhotoOps";
import { useScopeLoader } from "~/hooks/useScopeLoader";
import { useInspectionPrefs } from "~/hooks/useInspectionPrefs";
import { pushToast } from "~/hooks/useToast";
import { useKeyboard } from "~/hooks/useKeyboard";
import { useCannedComments } from "~/hooks/useCannedComments";
import { useUnsavedChanges } from "~/hooks/useUnsavedChanges";
import { usePresence } from "~/hooks/usePresence";
import { ThemeSegmentControl } from "~/components/sidebar/ThemeSegmentControl";
import { useResultsDoc } from "~/lib/collab/use-results-doc";
import { useMediaDrain } from "~/hooks/useMediaDrain";
import { bindResultMap, appendPendingPhoto } from "~/lib/collab/results-binding";
import { enqueueMedia } from "~/lib/collab/media-upload-queue";
import { VersionHistoryPanel } from "~/components/collab/VersionHistoryPanel";
import type { ResultsProjection } from "../../server/lib/collab/results-doc.types";
import { SectionRail } from "~/components/editor-shared/SectionRail";
import { EditorHeader } from "~/components/editor/EditorHeader";
import { FullscreenToggle } from "~/components/editor/FullscreenToggle";
import { ItemList } from "~/components/editor-shared/ItemList";
import { ItemEditor } from "~/components/editor/ItemEditor";
import { TagChipRow, type TagPin } from "~/components/editor/TagChipRow";
import type { DefectFieldsValue } from "~/components/editor/DefectFieldsRow";
import { SideRail } from "~/components/editor/SideRail";
import { SpeedMode } from "~/components/editor/SpeedMode";
import { FooterBar } from "~/components/editor/FooterBar";
import { BatchActionBar } from "~/components/editor/BatchActionBar";
import { capturePriorRatings } from "~/lib/editor/batch-undo";
import { reorderItemBySwap } from "~/lib/editor/reorder-by-swap";
import { KeyboardHud } from "~/components/editor/KeyboardHud";
import { InspectorToolsDock } from "~/components/editor/InspectorToolsDock";
import { BurstCamera } from "~/components/editor/BurstCamera";
import { PhotoAnnotator } from "~/components/media-studio/PhotoAnnotator";
import { PropertyInfoForm } from "~/components/editor/PropertyInfoForm";
import { resolveActivePropertyPreset } from "~/lib/property-preset";
import { PcaNarrativePanel } from "~/components/inspection/PcaNarrativePanel";
import { CompliancePanel } from "~/components/inspection-edit/CompliancePanel";
import { CommercialReportControls, type ReportTier } from "~/components/editor/CommercialReportControls";
import type { PcaNarrativeData } from "~/components/portal/sections/report/types";
import { InspectionSettingsSheet } from "~/components/editor/InspectionSettingsSheet";
import { CoverCropper } from "~/components/media-studio/CoverCropper";
import { PhotoCropper } from "~/components/media-studio/PhotoCropper";
import { MediaViewer } from "~/components/media-studio/MediaViewer";
import { PosterPicker } from "~/components/media-studio/PosterPicker";
import { VideoCapture } from "~/components/media-studio/VideoCapture";
import { fullResUrl } from "~/components/media-studio/cropImage";
import { preprocessImage } from "~/components/media-studio/preprocessImage";
import { PublishGateModal } from "~/components/editor/PublishGateModal";
import { AddMediaChooser } from "~/components/editor/AddMediaChooser";
import { RecropWarningModal } from "~/components/editor/RecropWarningModal";
import { StructureDeleteModal } from "~/components/editor/StructureDeleteModal";
import { AddSectionPromptModal } from "~/components/editor/AddSectionPromptModal";
import { AddItemTypeModal } from "~/components/editor/AddItemTypeModal";
import { SaveTemplateModal } from "~/components/editor/SaveTemplateModal";
import { useStructureEdit } from "~/hooks/useStructureEdit";
import { UnsavedChangesBlocker } from "~/components/editor/UnsavedChangesBlocker";
import { PublishModal } from "~/components/editor/PublishModal";
import { SignModal } from "~/components/editor/SignModal";
import { CommentLibraryDrawer } from "~/components/editor/CommentLibraryDrawer";
import { SectionPickerModal } from "~/components/editor/SectionPickerModal";
import { TagPickerModal } from "~/components/editor/TagPickerModal";
import { useIsMobile } from "~/hooks/useBreakpoint";
import { MobileAppBar } from "~/components/editor/MobileAppBar";
import { MobileDrawerTriggers, type MobileDrawerId } from "~/components/editor/MobileDrawerTriggers";
import { MobileBottomDrawer } from "~/components/MobileBottomDrawer";
import { BreadcrumbDropdown, type UnitScopeRow } from "~/components/editor/BreadcrumbDropdown";
import { UnitsManager } from "~/components/editor/UnitsManager";
import { CostItemsHost } from "~/components/editor/CostItemsHost";
import type { ResultMap } from "~/hooks/useInspection";
import type { PublishReadiness, PublishBlockingDefect } from "~/lib/types";
import { Button, IconButton, SegmentedControl } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

export function meta() {
 return [{ title: m.editor_route_meta_title() }];
}

/* ------------------------------------------------------------------ */
/* Upload quality preference (N2+N4)                                  */
/* ------------------------------------------------------------------ */

/**
 * Device-local opt-out for the upload preprocessing pass. Default OFF means
 * preprocessing is ON (downscale + EXIF/GPS strip). Persisted to localStorage
 * so the choice survives reloads and is read at all three photo entry points
 * (item picker, burst commit, offline replay) from one source of truth.
 */
export const ORIGINAL_QUALITY_KEY = "oi.uploads.originalQuality";
export function originalQualityEnabled(): boolean {
 try {
 return typeof localStorage !== "undefined" && localStorage.getItem(ORIGINAL_QUALITY_KEY) === "1";
 } catch {
 return false;
 }
}

/* ------------------------------------------------------------------ */
/* Loader */
/* ------------------------------------------------------------------ */

export { loader } from "./inspection-edit/loader.server";
import type { loader } from "./inspection-edit/loader.server";

/**
 * The editor holds its own optimistic state (useInspection) and persists every
 * change through fetchers. Re-running this heavy loader after each mutation
 * (rate / notes / save-settings / set-cover / upload-cover …) just reloads and
 * flickers the whole editor. Skip revalidation for POST submissions; navigation
 * and explicit `revalidator.revalidate()` (offline sync) still refresh because
 * they carry no POST formMethod.
 */
export function shouldRevalidate({
  formMethod,
  defaultShouldRevalidate,
}: {
  formMethod?: string;
  defaultShouldRevalidate: boolean;
}) {
  if (formMethod && formMethod.toUpperCase() === "POST") return false;
  return defaultShouldRevalidate;
}

/* ------------------------------------------------------------------ */
/* Action (BFF relay for client mutations) */
/* ------------------------------------------------------------------ */

export { action } from "./inspection-edit/action.server";

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Component */
/* ------------------------------------------------------------------ */

export default function InspectionEditPage() {
 const loaderData = useLoaderData<typeof loader>();
 const displayLocale = useDisplayLocale();
 const fetcher = useFetcher();
 // B-17: notes commit on blur and rating click fire in the same gesture;
 // sharing one fetcher made the rating submit CANCEL the in-flight notes
 // submit (React Router aborts the previous submission on re-submit) — the
 // note was silently lost. Notes get their own fetcher instance.
 const notesFetcher = useFetcher();
 // FE-2: photo uploads also get a dedicated fetcher — sharing the mutation
 // fetcher would let an autosave abort an in-flight upload (and vice versa).
 const uploadFetcher = useFetcher();
 // Publish gets its own fetcher so a publish precondition failure (e.g. "not
 // completed") is NOT swallowed by the generic autosave "Save failed" toast
 // (which only watches fetcher/notesFetcher/uploadFetcher). The real server
 // message is surfaced inline in the publish modal instead.
 const publishFetcher = useFetcher<{ ok: boolean; intent?: string; error?: string }>();
 const [publishError, setPublishError] = useState<string | null>(null);
 // Commercial PCA Phase S — narrative editor panel. Own fetcher (mirrors the
 // notes/upload isolation reasoning above) so a per-block blur save cannot be
 // aborted by an unrelated in-flight mutation. Dispatches the "save-pca-narrative"
 // intent through the route action (BFF pattern) — never a client fetch to /api/...
 const narrativeFetcher = useFetcher();
 const saveNarrative = useCallback((key: keyof PcaNarrativeData, value: string) => {
  narrativeFetcher.submit({ intent: "save-pca-narrative", key, value }, { method: "POST" });
 }, [narrativeFetcher]);
 // Commercial PCA Phase T — the commercial subtype + report tier selectors
 // (CommercialReportControls) get their own fetchers for the same reason the
 // narrative panel does: a selector change must not be aborted by an
 // unrelated in-flight mutation. They sit side by side in the same panel, so
 // a shared fetcher would let a quick tier click abort an in-flight subtype
 // save (or vice versa) — React Router cancels the previous submission when
 // the same useFetcher instance re-submits (see
 // feedback_rr_shared_fetcher_abort). Dispatches "save-property-facts"
 // through the route action (BFF pattern), which PATCHes the real
 // /api/inspections/:id/property-facts endpoint. (PropertyInfoForm now persists
 // its own strip fields via propertyFactsFetcher below — same intent, separate
 // fetcher.)
 const subtypeFetcher = useFetcher();
 const tierFetcher = useFetcher();
 const saveSubtype = useCallback((subtype: string | null) => {
  subtypeFetcher.submit({ intent: "save-property-facts", payload: JSON.stringify({ commercialSubtype: subtype }) }, { method: "POST" });
 }, [subtypeFetcher]);
 const saveTier = useCallback((tier: "light_commercial" | "full_pca") => {
  tierFetcher.submit({ intent: "save-property-facts", payload: JSON.stringify({ reportTier: tier }) }, { method: "POST" });
 }, [tierFetcher]);
 // Property Facts strip (PropertyInfoForm) durable save. A SINGLE shared fetcher
 // is abort-safe here — unlike subtype/tier above — because onCommit hands us a
 // FULL snapshot of every field each time, so a later PATCH is a strict superset
 // of any in-flight one. React Router cancels the previous submission when the
 // same useFetcher re-submits, but cancelling loses no data when the survivor
 // already carries the earlier field's value (mirrors PsqPanel.commitResponses;
 // see feedback_rr_shared_fetcher_abort). Rides the same "save-property-facts"
 // route intent (PATCHes /api/inspections/:id/property-facts). The form's onSave
 // keeps the optimistic local-state update; onCommit (this) persists.
 const propertyFactsFetcher = useFetcher();
 const savePropertyFacts = useCallback((facts: Record<string, unknown>) => {
  propertyFactsFetcher.submit({ intent: "save-property-facts", payload: JSON.stringify(facts) }, { method: "POST" });
 }, [propertyFactsFetcher]);
 // Commercial PCA Phase U (Batch C2b) — the units-manager mutation fetcher
 // (create/rename/delete/duplicate/bulk/mode-switch) and the lazy per-unit
 // results-slice fetcher (scope switch → merge missing findings).
 const unitsFetcher = useFetcher<{ ok: boolean; intent?: string }>();
 const scopeFetcher = useFetcher<{ ok: boolean; intent?: string; scope?: string; results?: ResultMap }>();
 const navigate = useNavigate();
 // Task 16 — split the single photo input into a camera capture input
 // (single file, capture=environment — "Take photo") and a library input
 // (multiple, no capture — "Add from library", desktop's default add-photo
 // affordance). Both feed the same handlePhotoUpload batch handler.
 const cameraInputRef = useRef<HTMLInputElement>(null);
 const libraryInputRef = useRef<HTMLInputElement>(null);

 /* Plan 7 — add-media chooser (photo OR video) + video capture overlay. The
  * add tile opens the chooser; Task 16 split "Photo" into "Take photo"
  * (camera input) and "Add from library" (multi-select library input),
  * "Video" opens VideoCapture. Video upload requires a connection (it does NOT
  * use the offline photo queue — clip sizes make IndexedDB replay impractical). */
 const [addMediaChooser, setAddMediaChooser] = useState<{ itemId: string } | null>(null);
 const [videoCaptureTarget, setVideoCaptureTarget] = useState<{ itemId: string } | null>(null);

 /* ---------------------------------------------------------------- */
 /* Core state (useInspection) */
 /* ---------------------------------------------------------------- */

 // Commercial PCA Phase U — the active per-unit scope threaded through the
 // editor's result keying. `null` = the `_default` common scope. In `tagged`
 // mode the scope switcher is hidden, so this stays null and behavior is
 // byte-identical to before. Batch C2b wires the switcher (per_unit mode).
 const [activeUnitId, setActiveUnitId] = useState<string | null>(null);

 // Commercial subtype-preset fields (nra, floorCount, sprinklered, ...) persist
 // in the property_facts JSON envelope, but the editor reads facts as flat
 // inspection[key]. Spread the envelope onto the seeded inspection so those
 // keys resolve uniformly for PropertyInfoForm and the report preview.
 // Dedicated columns win when a key exists in both (envelope first, row last).
 // Design 2026-07-13-oi-property-facts-commercial-persist.
 const seededInspection = useMemo(() => {
 const insp = loaderData.inspection as Record<string, unknown>;
 const envelope = (insp.propertyFacts as Record<string, unknown> | null) ?? {};
 return { ...envelope, ...insp };
 }, [loaderData.inspection]);

 const state = useInspectionState({
 inspection: seededInspection,
 schema: loaderData.schema as unknown as InspectionSchema,
 results: loaderData.results,
 ratingLevels: loaderData.ratingLevels,
 activeUnitId,
 });

 // The Property Info field list. For a commercial inspection with a chosen
 // subtype, thread that subtype's preset (nra/floorCount/... for office, etc.)
 // so those report-visible fields become editable and persist through the
 // metadata envelope. Recomputes when the Phase T selector changes
 // commercialSubtype (live, no fetch). resolveActivePropertyPreset returns
 // undefined for residential / no-subtype so PropertyInfoForm keeps its own
 // default field set (no residential regression, non-empty commercial fallback).
 const activePropertyPreset = useMemo(() => {
 const insp = state.inspection as Record<string, unknown>;
 return resolveActivePropertyPreset(
 insp.propertyType as string | null | undefined,
 insp.commercialSubtype as string | null | undefined,
 loaderData.commercialPresets,
 );
 }, [state.inspection, loaderData.commercialPresets]);

 /* ---------------------------------------------------------------- */
 /* #181 — collab Y.Doc (real-time editing; the only editor write path) */
 /* ---------------------------------------------------------------- */

 // Collaboration is unconditional: every editor write routes through the Y.Doc
 // (the legacy CAS / offline-queue write path was retired in Phase 5). The doc
 // connects in a client-only effect, so `collab?.doc` is briefly null on the
 // SSR / first-paint window before the connection initialises.
 //
 // #181 PR-G — the collab onSynced (initial connect + every reconnect) triggers
 // the offline media drain. `drainRef` breaks the cycle: useResultsDoc needs the
 // drain callback, but the drain (useMediaDrain) needs the live doc that
 // useResultsDoc returns. The ref is filled right after useMediaDrain below.
 const drainRef = useRef<() => void>(() => {});
 const collab = useResultsDoc(String(loaderData.inspection.id), () => drainRef.current());

 // #181 PR-G — build the media drain (uploader + doc swap) over the live doc.
 const { drain: mediaDrain } = useMediaDrain(String(loaderData.inspection.id), collab?.doc ?? null);
 drainRef.current = mediaDrain;

 // Once the doc is live, project it into the editor's `results`. First paint
 // uses loaderData.results (initial projection); the DO hydrated from the SAME
 // D1 blob (8.6) so swapping in the doc projection causes no flash.
 useEffect(() => {
   if (!collab?.doc) return;
   return bindResultMap(collab.doc, (next) => state.setResults(() => next));
 }, [collab?.doc, state.setResults]);

 /* ---------------------------------------------------------------- */
 /* Findings (CRUD) */
 /* ---------------------------------------------------------------- */

 const findings = useFindings(state.results, state.setResults, fetcher, {
 sectionIdForItem: state.sectionIdForItem,
 setDirty: state.setDirty,
 setSaveStatus: state.setSaveStatus,
 inspectionId: String(state.inspection.id),
 notesFetcher,
    // #181 — every write routes through the Y.Doc. The doc is briefly null on
    // the SSR / first-paint window before the connection initialises.
    collab: collab?.doc ? { doc: collab.doc } : undefined,
    // Phase U (Batch C1) — scope every read/write to the active unit (null = _default).
    activeUnitId,
 });

 /* ---------------------------------------------------------------- */
 /* Inspection prefs (tenant clone scope, auto-advance delay, pinned tags) */
 /* ---------------------------------------------------------------- */

 const { prefs: inspectionPrefs } = useInspectionPrefs();

 /* ---------------------------------------------------------------- */
 /* Tag library fetch + memos */
 /* ---------------------------------------------------------------- */

 // Track H (C-12): the tag library now arrives via the loader (token-relay)
 // instead of a raw client fetch against /api/tags.
 const tagLibrary = (loaderData.tagLibrary ?? []) as TagPin[];

 // Authoring unification Plan-4 module K — one tenant-wide category → color
 // lookup, built once from the loader's single fetch, keyed by BOTH name and
 // id (a defect's stored `category` may be either a legacy seed name or a
 // defect_categories.id, mirroring how the report resolves drivesSummary).
 const catColor = useMemo(() => {
  const map = new Map<string, string>();
  for (const c of loaderData.defectCategories ?? []) {
   map.set(c.name, c.color);
   map.set(c.id, c.color);
  }
  return map;
 }, [loaderData.defectCategories]);

 const pinnedTags = useMemo(() => {
 return inspectionPrefs.pinnedTagIds
 .map(id => tagLibrary.find(t => t.id === id))
 .filter((t): t is TagPin => Boolean(t));
 }, [inspectionPrefs.pinnedTagIds, tagLibrary]);

 const activeTagIds = useMemo(() => {
 if (!state.activeItemId) return new Set<string>();
 const tags = state.tagsByItem?.[state.activeItemId] || [];
 return new Set(tags.map((t: { id: string }) => t.id));
 }, [state.activeItemId, state.tagsByItem]);

 /* ---------------------------------------------------------------- */
 /* Publish gate state (declared early — used in missingFields memo below) */
 /* ---------------------------------------------------------------- */

 const [publishReadiness, setPublishReadiness] = useState<PublishReadiness | null>(null);
 const [showPublishGate, setShowPublishGate] = useState(false);

 /* ---------------------------------------------------------------- */
 /* Defect structured fields — local-state projections for ItemEditor */
 /* ---------------------------------------------------------------- */

 const activeResult = state.activeItemId
 ? findings.getResult(state.activeItemId, state.currentSection?.id)
 : null;

 const defectStates = useMemo(() => {
 const map = new Map<string, DefectFieldsValue>();
 const defects = (activeResult as Record<string, unknown> | null)?.tabs as
 | { defects?: Array<Record<string, unknown>> }
 | undefined;
 const rows = Array.isArray(defects?.defects) ? defects!.defects : [];
 for (const d of rows) {
 const cannedId = typeof d.cannedId === "string" ? d.cannedId : "";
 if (!cannedId) continue;
 map.set(cannedId, {
 location:  typeof d.location  === "string" ? d.location  : null,
 trade:     typeof d.trade     === "string" ? (d.trade     as DefectFieldsValue["trade"])     : null,
 deadline:  typeof d.deadline  === "string" ? (d.deadline  as DefectFieldsValue["deadline"])  : null,
 timeframe: typeof d.timeframe === "string" ? (d.timeframe as DefectFieldsValue["timeframe"]) : null,
 });
 }
 return map;
 }, [activeResult]);

 // Whole-inspection photo count for the Photos tab badge (P3). Sums per-item
 // result.photos across the results map.
 const inspectionPhotoCount = useMemo(() => {
 let n = 0;
 for (const value of Object.values(state.results)) {
 const photos = (value as Record<string, unknown> | null)?.photos;
 if (Array.isArray(photos)) n += photos.length;
 }
 return n;
 }, [state.results]);

 const locationSuggestions = useMemo(() => {
 const set = new Set<string>();
 for (const value of Object.values(state.results)) {
 const tabs = (value as Record<string, unknown> | null)?.tabs as
 | { defects?: Array<Record<string, unknown>> }
 | undefined;
 const rows = Array.isArray(tabs?.defects) ? tabs!.defects : [];
 for (const d of rows) {
 if (typeof d.location === "string" && d.location.length > 0) set.add(d.location);
 }
 }
 return Array.from(set);
 }, [state.results]);

 const missingFields = useMemo(() => {
 const map = new Map<string, { location: boolean; trade: boolean }>();
 if (!publishReadiness) return map;
 for (const b of publishReadiness.blockingDefects) {
  map.set(b.cannedId, {
   location: b.missing.includes('location'),
   trade:    b.missing.includes('trade'),
  });
 }
 return map;
 }, [publishReadiness]);

 // IA-7 — effective required-defect-fields policy: per-inspection override
 // (NULL = inherit) falls back to the tenant default from inspection prefs.
 // Drives the proactive red asterisk on every defect row.
 const requiredDefectFields = useMemo(() => {
  const override = (loaderData.inspection as Record<string, unknown>).requireDefectFieldsOverride as
   'none' | 'location' | 'trade' | 'both' | null | undefined;
  const effective = override ?? inspectionPrefs.requireDefectFields;
  return {
   location: effective === 'location' || effective === 'both',
   trade:    effective === 'trade'    || effective === 'both',
  };
 }, [loaderData.inspection, inspectionPrefs.requireDefectFields]);

 /* ---------------------------------------------------------------- */
 /* Canned comments library */
 /* ---------------------------------------------------------------- */

 const comments = useCannedComments({
 inspectionId: String(state.inspection.id),
 severityForRatingId: state.severityForRatingId,
 });

 /* ---------------------------------------------------------------- */
 /* Server-fetched comments for the library drawer + SideRail tab   */
 /* ---------------------------------------------------------------- */

 const [serverComments, setServerComments] = useState<Array<{
 id: string; text: string; useCount?: number; lastUsedAt?: string | null;
 }>>([]);

 // Tracks whether the SideRail library tab is open; combined with
 // showCommentLibrary to decide when to fetch server comments.
 const [librarySideOpen, setLibrarySideOpen] = useState(false);

 useEffect(() => {
 if (!state.showCommentLibrary && !librarySideOpen) { setServerComments([]); return; }
 const ctx: { itemLabel?: string; section?: string; severity?: string; search?: string } = {};
 if (comments.filterMode === 'auto' && state.activeItem) {
 ctx.itemLabel = (state.activeItem.label || state.activeItem.name || '') as string;
 ctx.section   = state.currentSection?.title;
 const r = state.activeItemId ? state.getResult(state.activeItemId)?.rating : null;
 if (r && state.severityForRatingId) {
 ctx.severity = state.severityForRatingId(r as string);
 }
 }
 // Track H (IA-5) — the modal's search box queries the SERVER (SQL pushdown
 // over the whole tenant library incl. imported rows); it used to only reset
 // the keyboard cursor. Severity chips override the context-derived severity.
 const q = state.commentLibrarySearch.trim();
 if (q.length >= 2) ctx.search = q;
 if (['good', 'marginal', 'significant'].includes(state.commentLibraryFilter)) {
 ctx.severity = state.commentLibraryFilter;
 }
 let cancelled = false;
 const t = setTimeout(() => {
 comments.fetchFiltered(ctx).then((rows) => {
 if (cancelled) return;
 setServerComments(rows as Array<{ id: string; text: string; useCount?: number; lastUsedAt?: string | null }>);
 });
 }, q ? 250 : 0);
 return () => { cancelled = true; clearTimeout(t); };
 }, [
 state.showCommentLibrary,
 librarySideOpen,
 state.commentLibrarySearch,
 state.commentLibraryFilter,
 comments.sort,
 comments.filterMode,
 state.activeItemId,
 state.activeItem,
 state.currentSection,
 comments.fetchFiltered,
 state.getResult,
 state.severityForRatingId,
 ]);

 const revalidator = useRevalidator();

 /* ---------------------------------------------------------------- */
 /* Commercial PCA Phase U (Batch C2b) — per-unit scope switcher + manager */
 /* ---------------------------------------------------------------- */

 const units = (loaderData.units ?? []) as UnitScopeRow[];
 const unitInspectionMode = loaderData.unitInspectionMode ?? "tagged";
 const isPerUnit = unitInspectionMode === "per_unit";
 const [unitsManagerOpen, setUnitsManagerOpen] = useState(false);

 // Only 'commercial' inspections expose the units surface (same gate as the PCA
 // narrative panel). Residential editors never see the switcher/manager, so they
 // render byte-identically to before.
 const showUnitsSurface = (loaderData.inspection as Record<string, unknown>).propertyType === "commercial";

 // Commercial PCA Phase C Task 13b — Cost Items drawer (Opinion of Cost /
 // ASTM E2018 Table 1). Same commercial-only gate as the units surface;
 // self-loads its data on open via CostItemsHost, so it doesn't need
 // anything threaded through the (already very large) inspection-edit loader.
 const [costItemsOpen, setCostItemsOpen] = useState(false);

 // When the collab doc has synced, `readResultMap` already holds EVERY scope's
 // findings (the DO hydrated the full D1 blob), so a scope switch needs no fetch.
 const collabSynced = Boolean(collab?.synced);

 // Scope switch is fetch-if-missing, tracked in useScopeLoader (which owns the
 // merged/in-flight bookkeeping + the shared-fetcher abort race). This wrapper
 // just also sets the active-unit UI state.
 const submitScope = useCallback(
  (scope: string) => scopeFetcher.submit({ intent: "load-scope", scope }, { method: "POST" }),
  [scopeFetcher],
 );
 const mergeScopeSlice = useCallback(
  (slice: ResultMap) => state.setResults((prev) => ({ ...prev, ...slice })),
  [state.setResults],
 );
 const loadScope = useScopeLoader({
  collabSynced,
  fetcherData: scopeFetcher.data,
  submit: submitScope,
  onSlice: mergeScopeSlice,
 });
 const requestScope = useCallback(
  (unitId: string | null) => {
   setActiveUnitId(unitId);
   loadScope(unitId);
  },
  [loadScope],
 );

 // After any units mutation lands, revalidate so the switcher / manager /
 // progress refresh from the loader. (POST submissions skip revalidation via
 // shouldRevalidate; this explicit call carries no formMethod so it runs.)
 // `unitsFetcher.data` keeps the same {ok:true} reference until the next submit
 // and `revalidator` is a fresh object each render, so without a one-shot guard
 // this effect re-fires every render → an unbounded revalidation storm. Track
 // the last-revalidated data object so each distinct result revalidates once.
 const lastRevalidatedUnitsData = useRef<unknown>(null);
 useEffect(() => {
  const d = unitsFetcher.data;
  if (unitsFetcher.state === "idle" && d?.ok && lastRevalidatedUnitsData.current !== d) {
   lastRevalidatedUnitsData.current = d;
   revalidator.revalidate();
  }
 }, [unitsFetcher.state, unitsFetcher.data, revalidator]);

 // If the active unit was deleted (or the inspection left per_unit mode), fall
 // back to the common scope so reads never point at a vanished unit.
 useEffect(() => {
  if (activeUnitId == null) return;
  if (!isPerUnit || !units.some((u) => u.id === activeUnitId)) {
   setActiveUnitId(null);
  }
 }, [activeUnitId, isPerUnit, units]);

 /* ---------------------------------------------------------------- */
 /* Unsaved changes guard */
 /* ---------------------------------------------------------------- */

 const { blocker, confirmLeave, cancelLeave } = useUnsavedChanges(state.dirty);

 /* ---------------------------------------------------------------- */
 /* Presence roster (multi-inspector collaboration) */
 /* ---------------------------------------------------------------- */

 const presence = usePresence({
  inspectionId: String(state.inspection.id),
  userId: "current-user", // will be replaced with real user ID later
  userName: "Inspector",
  enabled: true,
 });

 useEffect(() => {
  presence.setFocus(state.activeItemId);
 }, [state.activeItemId]);

 /* ---------------------------------------------------------------- */
 /* Tag picker */
 /* ---------------------------------------------------------------- */

 const [tagPickerOpen, setTagPickerOpen] = useState(false);

 /* ---------------------------------------------------------------- */
 /* Auto-sign toggle + manual sign modal */
 /* ---------------------------------------------------------------- */

 const signFetcher = useFetcher<{ ok: boolean }>();
 const [autoSign, setAutoSign] = useState<boolean>(
  !!(state.inspection as Record<string, unknown>).autoSignOnPublish,
 );
 const [signModalOpen, setSignModalOpen] = useState(false);
 // #181 — version-history panel (collab Phase 4). Inert when collab is off.
 const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);

 // Sync autoSign local state from loader data when inspection changes
 useEffect(() => {
  setAutoSign(!!(state.inspection as Record<string, unknown>).autoSignOnPublish);
 }, [state.inspection]);

 const handleAutoSignToggle = useCallback(
  (checked: boolean) => {
   setAutoSign(checked);
   signFetcher.submit(
    { intent: "toggle-auto-sign", autoSignOnPublish: String(checked) },
    { method: "post" },
   );
  },
  [signFetcher],
 );

 const handleSignSubmit = useCallback(
  async (dataUri: string) => {
   signFetcher.submit(
    { intent: "sign-inspector", signatureBase64: dataUri },
    { method: "post" },
   );
   setSignModalOpen(false);
  },
  [signFetcher],
 );

 /* ---------------------------------------------------------------- */
 /* Publish pre-flight */
 /* ---------------------------------------------------------------- */

 const handlePublishClick = useCallback(async () => {
  setPublishError(null);
  try {
   // Track H (C-12): fresh on-demand check via the BFF resource route
   // (token relay) — never a raw client fetch on /api.
   const res = await fetch(`/resources/publish-readiness?id=${encodeURIComponent(state.inspection.id)}`, {
    credentials: 'include',
   });
   if (res.ok) {
    const body = await res.json() as { readiness: PublishReadiness | null };
    // IA-7: hard gaps block; soft gaps (below the tenant's required
    // threshold) surface as a yellow warning pass with "Publish anyway".
    if (body.readiness && (!body.readiness.ready || (body.readiness.warningDefects?.length ?? 0) > 0)) {
     setPublishReadiness(body.readiness);
     setShowPublishGate(true);
     return;
    }
   }
  } catch {
   // Network/server error — fall through to publish (don't block UX on a flaky readiness check)
  }
  state.setShowPublishModal(true);
 }, [state.inspection.id, state.setShowPublishModal]);

 /* ---------------------------------------------------------------- */
 /* Item attribute handler */
 /* ---------------------------------------------------------------- */

 const handleItemAttribute = useCallback((itemId: string, attributeId: string, value: string | number | boolean | null) => {
  fetcher.submit(
   {
    intent: 'set-item-attribute',
    itemId,
    attributeId,
    value: JSON.stringify(value),
   },
   { method: 'POST' },
  );
 }, [fetcher]);

 /* Photo studio state */
 const [photoStudioOpen, setPhotoStudioOpen] = useState(false);
 const [photoStudioUrl, setPhotoStudioUrl] = useState<string | null>(null);
 const [photoStudioKey, setPhotoStudioKey] = useState<string | null>(null);
 const [photoStudioIndex, setPhotoStudioIndex] = useState(0);
 const [photoStudioTotal, setPhotoStudioTotal] = useState(0);
 // Single entry point for opening the PhotoAnnotator — keeps the five state
 // setters in lockstep across every caller (gallery annotate, tools dock).
 const openPhotoStudio = useCallback(
  (next: { url: string | null; key: string | null; index: number; total: number }) => {
   setPhotoStudioUrl(next.url);
   setPhotoStudioKey(next.key);
   setPhotoStudioIndex(next.index);
   setPhotoStudioTotal(next.total);
   setPhotoStudioOpen(true);
  },
  [],
 );
 // DB-16 — dedicated fetcher for set/clear report cover (avoids the
 // shared-fetcher abort hazard; the loader revalidates the cover after).
 const coverFetcher = useFetcher();

 /* ---------------------------------------------------------------- */
 /* D8 — structural editing (section add/dup/delete/move)           */
 /* ---------------------------------------------------------------- */

 const structure = useStructureEdit({
  rawSnapshot: loaderData.templateSnapshot,
  collabEditing: loaderData.collabEditing,
  results: state.results,
  templateId: (state.inspection.templateId as string | null | undefined) ?? null,
  // Phase U (Batch C2a) — scope the delete-impact tally to the active unit.
  activeUnitId,
  // Optimistic display refresh: structural edits POST + skip revalidation, so
  // push the new section list straight into editor state (the rail / item list
  // re-render immediately instead of only after a reload).
  onApply: (next) => state.setSections(next.sections as unknown as Parameters<typeof state.setSections>[0]),
 });

 /* Plan 7 — Stream customer subdomain (from loader env). Null ⇒ fail closed:
  * video posters/players render a graceful "unavailable" state, never a
  * fabricated subdomain. */
 const streamCustomerSubdomain = loaderData.streamCustomerSubdomain ?? null;
 /* Plan 7 — resolved video backend provider for this tenant ('r2' by default).
  * Drives VideoCapture checkbox gating and VideoPlayer branch selection. */
 const videoProvider = loaderData.videoProvider ?? "r2";

 /* ---------------------------------------------------------------- */
 /* Photo / media operations (extracted hook) */
 /* ---------------------------------------------------------------- */

 const {
  viewer,
  setViewer,
  photoCropTarget,
  setPhotoCropTarget,
  recropWarn,
  setRecropWarn,
  galleryCropSource,
  setGalleryCropSource,
  posterTarget,
  setPosterTarget,
  coverKey,
  videoPosterUrl,
  pendingPhotoUrl,
  itemGalleryPhotos,
  onOpenPhoto,
  onReorderPhotos,
  onBulkDetachPhotos,
  moveTargets,
  onBulkMovePhotos,
  onViewerAction,
  performPhotoCropSave,
  performPhotoAnnotationSave,
 } = usePhotoOps({
  state,
  findings,
  streamCustomerSubdomain,
  // #181 — photo array ops route through the Y.Doc (the DO persists it to D1).
  collabDoc: collab?.doc ?? null,
  // Phase U (Batch C2a) — scope photo composite keys to the active unit.
  activeUnitId,
  setPhotoStudioUrl,
  setPhotoStudioKey,
  setPhotoStudioIndex,
  setPhotoStudioTotal,
  setPhotoStudioOpen,
 });

 /* Mobile shell state */
 const isMobile = useIsMobile();
 const [mobileDrawer, setMobileDrawer] = useState<MobileDrawerId | null>(null);

 const PRESET_TAGS = useMemo(() => [
  { id: "follow-up", name: "Follow Up", color: "#ef4444" },
  { id: "urgent", name: "Urgent", color: "#f97316" },
  { id: "photo-needed", name: "Photo Needed", color: "#eab308" },
  { id: "re-inspect", name: "Re-inspect", color: "#3b82f6" },
  { id: "client-question", name: "Client Question", color: "#a855f7" },
 ], []);

 const toggleTag = useCallback((tag: { id: string; name: string; color: string }) => {
  if (!state.activeItemId) return;
  const current = state.tagsByItem[state.activeItemId] || [];
  const exists = current.some(t => t.id === tag.id);
  const updated = exists
   ? current.filter(t => t.id !== tag.id)
   : [...current, tag];
  state.setTagsByItem(prev => ({
   ...prev,
   [state.activeItemId!]: updated,
  }));
 }, [state.activeItemId, state.tagsByItem, state.setTagsByItem]);

 /* ---------------------------------------------------------------- */
 /* Tag chip row + clone-last handler for ItemEditor */
 /* ---------------------------------------------------------------- */

 const tagChipRow = state.activeItemId ? (
  <TagChipRow
   pinnedTags={pinnedTags}
   activeTagIds={activeTagIds}
   onToggle={(tag) => toggleTag(tag)}
  />
 ) : null;

 const handleCloneLast = useCallback((scope: 'rating' | 'rating_notes' | 'all') => {
  if (!state.activeItemId || !state.currentSection) return;
  findings.cloneLast(
   state.currentSection.id,
   state.activeItemId,
   state.currentSectionItems as Array<{ id: string }>,
   scope,
  );
 }, [findings, state.activeItemId, state.currentSection, state.currentSectionItems]);

 useEffect(() => {
  if (!tagPickerOpen) return;
  const handler = (e: KeyboardEvent) => {
   if (e.key === "Escape") {
    e.preventDefault();
    setTagPickerOpen(false);
   }
  };
  window.addEventListener("keydown", handler);
  return () => window.removeEventListener("keydown", handler);
 }, [tagPickerOpen]);

 /* ---------------------------------------------------------------- */
 /* Track fetcher state for save indicator */
 /* ---------------------------------------------------------------- */

 useEffect(() => {
 // B-17: "fetcher went idle" is NOT "saved" — check the action's ok flag.
 // A failed write keeps dirty=true so the unsaved-changes blocker still arms.
 // FE-2: uploadFetcher participates too — otherwise a photo upload leaves
 // dirty=true forever and the beforeunload blocker traps the inspector.
 const submitting =
 fetcher.state !== "idle" || notesFetcher.state !== "idle" || uploadFetcher.state !== "idle";
 const failed =
 (fetcher.data as { ok?: boolean } | undefined)?.ok === false ||
 (notesFetcher.data as { ok?: boolean } | undefined)?.ok === false ||
 (uploadFetcher.data as { ok?: boolean } | undefined)?.ok === false;
 if (submitting) {
 state.setSaveStatus("saving");
 } else if (state.saveStatus === "saving") {
 if (failed) {
 state.setSaveStatus("error");
 pushToast({
 message: m.editor_route_save_failed(),
				variant: "error",
 durationMs: 8000,
 });
 } else {
 state.setSaveStatus("saved");
 state.setDirty(false);
 const timer = setTimeout(() => state.setSaveStatus("idle"), 2000);
 return () => clearTimeout(timer);
 }
 }
 }, [fetcher.state, notesFetcher.state, uploadFetcher.state]);

 /* ---------------------------------------------------------------- */
 /* Publish result — surface the real server reason (e.g. "not       */
 /* completed") inline in the modal instead of the generic toast.    */
 /* ---------------------------------------------------------------- */
 useEffect(() => {
 if (publishFetcher.state !== "idle" || !publishFetcher.data) return;
 const data = publishFetcher.data;
 if (data.ok) {
 // Successful publish: clear any prior error, close the modal, and refresh
 // loader data so the editor reflects the now-published status.
 setPublishError(null);
 state.setShowPublishModal(false);
 revalidator.revalidate();
 } else {
 // Failed precondition: keep the modal open and show the actual reason.
 setPublishError(data.error ?? "Couldn't publish the report. Please try again.");
 }
 }, [publishFetcher.state, publishFetcher.data, state.setShowPublishModal, revalidator]);

 /* ---------------------------------------------------------------- */
 /* Rating handler with auto-advance */
 /* ---------------------------------------------------------------- */

 /**
 * B-18 — two root causes lived here:
 * 1. `find(l => l.id === rating)` missed because the old hardcoded
 * buttons emitted 'DEF' while levels carry ids like 'Defect', so
 * `pausesAdvance` (Defect/Monitor stop for notes) never fired.
 * `findRatingLevel` normalises the lookup.
 * 2. Advance ran for every input source. Pointer clicks are the
 * deliberate-editing path (rate → describe → photo); only keyboard
 * rating speed-scans forward (configurable via prefs.autoAdvance).
 */
 const handleRating = useCallback(
 (rating: string, source: 'pointer' | 'keyboard' = 'pointer') => {
 if (!state.activeItemId || !state.currentSection) return;
 findings.setRating(state.currentSection.id, state.activeItemId, rating);
 const level = findRatingLevel(state.ratingLevels ?? [], rating);
 const decision = ratingAdvanceDecision({
 source,
 level,
 mode: inspectionPrefs.autoAdvance,
 });
 if (decision.focusNotes) {
 const ta = document.getElementById('notes-textarea') as HTMLTextAreaElement | null;
 ta?.focus({ preventScroll: true });
 return;
 }
 if (!decision.advance) return;
 setTimeout(
 () => state.advanceToNextUnrated((newSectionTitle: string) => {
 pushToast({
 message: m.editor_route_entered_next_section({ section: newSectionTitle }),
 durationMs: 2500,
 });
 }),
 inspectionPrefs.autoAdvanceDelayMs,
 );
 },
 [state.activeItemId, state.currentSection, findings, state.advanceToNextUnrated, state.ratingLevels, inspectionPrefs.autoAdvance, inspectionPrefs.autoAdvanceDelayMs],
 );

 /* ---------------------------------------------------------------- */
 /* Comment library filtered items */
 /* ---------------------------------------------------------------- */

 const commentLibraryItems = useMemo(
 () =>
 comments.getFilteredComments(
 state.commentLibraryFilter,
 state.commentLibrarySearch,
 ),
 [comments, state.commentLibraryFilter, state.commentLibrarySearch],
 );

 /* ---------------------------------------------------------------- */
 /* Speed mode helpers */
 /* ---------------------------------------------------------------- */

 const toggleSpeedMode = useCallback(() => {
 if (!state.speedMode) {
 // Build flat queue of unrated items
 const flatItems: typeof state.speedItemsRef.current = [];
 for (let s = 0; s < state.sections.length; s++) {
 const sec = state.sections[s];
 for (let i = 0; i < sec.items.length; i++) {
 const item = sec.items[i];
 const r = state.getResult(item.id, sec.id);
 flatItems.push({
 id: item.id,
 label: item.label || item.name || "",
 sectionName: sec.title || sec.name || "",
 sectionIdx: s,
 itemIdx: i,
 rating: (r?.rating as string) || null,
 });
 }
 }
 const queue = flatItems
 .map((it, idx) => ({ idx, rating: it.rating }))
 .filter((x) => !x.rating)
 .map((x) => x.idx);

 if (queue.length === 0) return;
 state.speedItemsRef.current = flatItems;
 state.setSpeedQueue(queue);
 state.setSpeedCurrent(0);
 state.setSpeedMode(true);
 } else {
 state.setSpeedMode(false);
 }
 }, [state]);

 const speedRate = useCallback(
 (levelIdx: number) => {
 if (!state.speedMode) return;
 const qi = state.speedQueue[state.speedCurrent];
 if (qi == null) return;
 const item = state.speedItemsRef.current[qi];
 if (!item || !state.ratingLevels[levelIdx]) return;
 const sid = state.sectionIdForItem(item.id);
 if (sid) {
 findings.setRating(sid, item.id, state.ratingLevels[levelIdx].id);
 }
 // Remove from queue + auto-advance
 const newQueue = [...state.speedQueue];
 newQueue.splice(state.speedCurrent, 1);
 state.setSpeedQueue(newQueue);
 if (newQueue.length === 0) {
 setTimeout(() => state.setSpeedMode(false), 1500);
 return;
 }
 if (state.speedCurrent >= newQueue.length) {
 state.setSpeedCurrent(newQueue.length - 1);
 }
 },
 [state, findings],
 );

 /* ---------------------------------------------------------------- */
 /* Speed mode derived data */
 /* ---------------------------------------------------------------- */

 const speedItem = useMemo(() => {
 if (!state.speedMode) return null;
 const idx = state.speedQueue[state.speedCurrent];
 return idx != null ? state.speedItemsRef.current[idx] || null : null;
 }, [state.speedMode, state.speedQueue, state.speedCurrent]);

 // Shared next/prev cursor moves for the SpeedMode overlay (clamped to the queue).
 const speedNext = useCallback(() => {
 if (state.speedCurrent < state.speedQueue.length - 1) {
 state.setSpeedCurrent(state.speedCurrent + 1);
 }
 }, [state.speedCurrent, state.speedQueue.length, state.setSpeedCurrent]);

 const speedPrev = useCallback(() => {
 if (state.speedCurrent > 0) {
 state.setSpeedCurrent(state.speedCurrent - 1);
 }
 }, [state.speedCurrent, state.setSpeedCurrent]);

 /* ---------------------------------------------------------------- */
 /* Photo upload */
 /* ---------------------------------------------------------------- */

 /**
 * FE-2 — uploads go through the route action ("upload-photo" intent) on a
 * dedicated fetcher: the old direct fetch('/api/…/upload') bypassed the
 * BFF token relay (unauthenticated in saas, C-12 class) and swallowed
 * every failure silently. The effect below attaches returned keys and
 * surfaces failures as a toast.
 */
 // FE-3 — when set, the next picked photo pins to this defect row instead
 // of the item; armed by ItemEditor's per-defect chip right before the
 // picker opens, consumed (and cleared) by handlePhotoUpload.
 const pendingPhotoTargetRef = useRef<{ kind: "canned" | "custom"; id: string } | null>(null);

 // Task 16 — Worker subrequest safety: a single submission fans out one
 // upstream upload call per file (see action.server.ts's mapPool), so an
 // unbounded selection could blow the per-request subrequest budget. Cap the
 // batch and tell the user rather than silently dropping the overflow.
 const MAX_BATCH_PHOTOS = 20;

 const handlePhotoUpload = useCallback(
 (e: React.ChangeEvent<HTMLInputElement>) => {
 const all = Array.from(e.target.files ?? []);
 if (all.length === 0 || !state.activeItemId) return;
 const itemId = state.activeItemId;
 const overflow = all.length > MAX_BATCH_PHOTOS;
 const files = overflow ? all.slice(0, MAX_BATCH_PHOTOS) : all;

 // N2+N4 — bake before submit (auto-orient + downscale + EXIF/GPS strip),
 // unless the user opted into original quality. Capture the
 // defect target ref into a local BEFORE the await so a second picker open
 // cannot clobber it. The offline branch below keeps the RAW File (Task 5
 // bakes at replay). Single-file selections take this exact same path with
 // a one-element array, so behavior is byte-identical to the old code.
 const orig = originalQualityEnabled();
 const target = pendingPhotoTargetRef.current;
 pendingPhotoTargetRef.current = null;
 void (async () => {
 const bakedFiles: File[] = [];
 for (const f of files) {
 bakedFiles.push(orig ? f : await preprocessImage(f));
 }

 // #181 PR-G — offline: persist each baked photo locally + append a
 // PENDING doc entry (empty key + pendingUpload) per file. The strip
 // renders them from the local blob; the drain (on reconnect / online)
 // uploads each to R2 and swaps in the real key. Defect-targeted offline
 // adds fall back to the online fetcher (the pending-doc model covers
 // item photos; defect pending is out of scope) — they simply re-fire
 // when back online.
 const doc = collab?.doc ?? null;
 const sid = state.sectionIdForItem(itemId) ?? state.currentSection?.id;
 if (typeof navigator !== "undefined" && navigator.onLine === false && doc && sid && !target) {
  // Phase U (Batch C2a) — key the offline pending-photo doc entry to the active
  // unit. At activeUnitId == null this === the legacy `_default:{sid}:{itemId}`.
  const fk = findingKey(activeUnitId, sid, itemId);
  for (const baked of bakedFiles) {
  const pendingId = crypto.randomUUID();
  await enqueueMedia({
  pendingId,
  inspectionId: String(state.inspection.id),
  findingKey: fk,
  kind: "photo",
  blob: baked,
  enqueuedAt: Date.now(),
  });
  appendPendingPhoto(doc, fk, pendingId);
  }
 } else {
  const formData = new FormData();
  formData.append("intent", "upload-photo");
  formData.append("itemId", itemId);
  for (const baked of bakedFiles) formData.append("file", baked);
  if (target) {
  formData.append("targetType", "defect");
  formData.append("customId", target.id);
  formData.append("defectKind", target.kind);
  }
  uploadFetcher.submit(formData, { method: "post", encType: "multipart/form-data" });
 }

 if (overflow) {
  pushToast({
  message: m.editor_route_photos_batch_capped(),
  variant: "warning",
  durationMs: 6000,
  });
 }
 })();
 // Reset both inputs so re-picking the same file(s) re-fires onChange
 if (cameraInputRef.current) cameraInputRef.current.value = "";
 if (libraryInputRef.current) libraryInputRef.current.value = "";
 },
 [state.activeItemId, state.inspection.id, uploadFetcher, collab?.doc, state.sectionIdForItem, state.currentSection, activeUnitId],
 );

 const handleBurstCommit = useCallback(
 (blobs: Blob[]) => {
 if (!state.burstCameraItemId || blobs.length === 0) return;
 const itemId = state.burstCameraItemId;

 // N4 — bake each frame before upload. Burst frames are already
 // canvas-captured JPEGs (no EXIF), so this is purely the downscale; it
 // no-ops on frames already below the cap. Honors the original-quality opt-out.
 const orig = originalQualityEnabled();
 void (async () => {
 const formData = new FormData();
 formData.append("intent", "upload-photo");
 formData.append("itemId", itemId);
 for (let i = 0; i < blobs.length; i++) {
  const f = new File([blobs[i]], `burst-${i + 1}.jpg`, { type: "image/jpeg" });
  formData.append("file", orig ? f : await preprocessImage(f));
 }
 uploadFetcher.submit(formData, { method: "post", encType: "multipart/form-data" });
 })();
 },
 [state.burstCameraItemId, state.inspection.id, uploadFetcher],
 );

 // Attach uploaded photo keys once the action responds — to the item, or
 // (FE-3) to the specific defect row the action echoes back.
 const processedUploadData = useRef<unknown>(null);
 useEffect(() => {
 const d = uploadFetcher.data as
 | {
 ok?: boolean;
 keys?: string[];
 // Task 15/16 — per-file status; drives the partial-failure toast below.
 results?: Array<{ index: number; ok: boolean; key?: string; error?: string }>;
 itemId?: string;
 targetType?: "item" | "defect";
 customId?: string;
 defectKind?: "canned" | "custom";
 }
 | undefined;
 if (uploadFetcher.state !== "idle" || !d || processedUploadData.current === d) return;
 processedUploadData.current = d;
 // Attach every successful key exactly as before — unchanged regardless of
 // whether the submission was a single file or a batch.
 if (d.keys?.length && d.itemId) {
 for (const k of d.keys) {
 if (d.targetType === "defect" && d.customId) {
 findings.addPhotoToDefect(
 d.itemId,
 { kind: d.defectKind ?? "canned", id: d.customId },
 k,
 );
 } else {
 findings.addPhotoToItem(d.itemId, k);
 }
 }
 }
 // Task 16 — results[] lets a batch report exactly how many of a large
 // selection made it, instead of an all-or-nothing toast. d.ok is derived
 // from results.every(ok) server-side, so without this a single failed file
 // in a 12-photo batch would fire BOTH the success toast (for the 11 that
 // attached) and the old generic failure toast — keep them mutually
 // exclusive here.
 if (d.results?.length) {
 const total = d.results.length;
 const successCount = d.results.filter((r) => r.ok).length;
 const failCount = total - successCount;
 if (failCount > 0) {
 pushToast({
 message: m.editor_route_photos_partial_upload({ success: successCount, total, failed: failCount }),
 variant: "error",
 durationMs: 8000,
 });
 } else {
 pushToast({
 message: m.editor_route_photos_added({ count: successCount, s: successCount === 1 ? "" : "s", toDefect: d.targetType === "defect" ? " to defect" : "" }),
 variant: "success",
 durationMs: 2000,
 });
 }
 } else if (d.ok === false) {
 // Fallback for a response shape without results[] (e.g. an older/other
 // action path) — preserves the pre-Task-16 generic failure toast.
 pushToast({
 message: m.editor_route_photo_upload_failed(),
 variant: "error",
 durationMs: 8000,
 });
 }
 }, [uploadFetcher.state, uploadFetcher.data, findings]);

 /* ---------------------------------------------------------------- */
 /* Open-snippets callback (shared by keyboard shortcut + textarea trigger) */
 /* ---------------------------------------------------------------- */

 const openSnippets = useCallback(() => {
 if (!state.activeItemId) return;
 state.setCommentLibraryFilter("my-snippets");
 state.setCommentLibrarySearch("");
 state.setCommentLibrarySelectedIdx(0);
 state.setShowCommentLibrary(true);
 }, [state]);

 // Shared insert handler used by both the CommentLibraryDrawer and the
 // SideRail library tab — keeps the insert logic in one place (DRY).
 const onInsert = useCallback((sectionId: string, itemId: string, text: string) => {
 findings.insertComment(sectionId, itemId, text);
 }, [findings]);

 /* ---------------------------------------------------------------- */
 /* Keyboard shortcuts */
 /* ---------------------------------------------------------------- */

 const keyboardHandlers = useMemo(
 () => ({
 onRate: (level: number) => {
 if (state.activeItemId && state.currentSection && state.ratingLevels[level - 1]) {
 handleRating(state.ratingLevels[level - 1].id, 'keyboard');
 }
 },
 onClearRating: () => {
 if (state.activeItemId && state.currentSection) {
 findings.setRating(state.currentSection.id, state.activeItemId, null);
 }
 },
 onNARating: () => {
 if (!state.activeItemId || !state.currentSection) return;
 const naLevel = state.ratingLevels.find((l) => {
 const ab = (l.abbreviation || "").toUpperCase();
 const nm = (l.name || l.label || "").toLowerCase();
 return ab === "NA" || ab === "N/A" || nm.includes("not applicable");
 });
 if (naLevel) {
 handleRating(naLevel.id, 'keyboard');
 }
 },
 onNextItem: () => state.navigateItem(1),
 onPrevItem: () => state.navigateItem(-1),
 onToggleSpeed: toggleSpeedMode,
 speedMode: state.speedMode,
 onSpeedRate: speedRate,
 onSpeedNext: () => {
 if (state.speedCurrent < state.speedQueue.length - 1) {
 state.setSpeedCurrent(state.speedCurrent + 1);
 } else {
 state.setSpeedCurrent(0);
 }
 },
 onSpeedPrev: () => {
 if (state.speedCurrent > 0) {
 state.setSpeedCurrent(state.speedCurrent - 1);
 }
 },
 onSpeedOpenEditor: () => {
 if (!state.speedMode) return;
 const qi = state.speedQueue[state.speedCurrent];
 if (qi == null) return;
 const item = state.speedItemsRef.current[qi];
 if (!item) return;
 state.setSpeedMode(false);
 state.setActiveItemId(item.id);
 state.setCurrentSectionIdx(item.sectionIdx);
 },
 onOpenLibrary: () => {
 if (!state.activeItemId) return;
 const r = state.getResult(state.activeItemId);
 state.setCommentLibraryFilter(
 state.severityForRatingId(r?.rating as string),
 );
 state.setCommentLibrarySearch("");
 state.setCommentLibrarySelectedIdx(0);
 state.setShowCommentLibrary(true);
 },
 onOpenSnippets: openSnippets,
 showCommentLibrary: state.showCommentLibrary,
 onLibraryDown: () => {
 state.setCommentLibrarySelectedIdx(
 Math.min(
 state.commentLibrarySelectedIdx + 1,
 Math.max(serverComments.length, commentLibraryItems.length) - 1,
 ),
 );
 },
 onLibraryUp: () => {
 state.setCommentLibrarySelectedIdx(
 Math.max(state.commentLibrarySelectedIdx - 1, 0),
 );
 },
 onLibrarySelect: () => {
 const sel = serverComments[state.commentLibrarySelectedIdx]
 ?? commentLibraryItems[state.commentLibrarySelectedIdx];
 if (sel && state.activeItemId && state.currentSection) {
 findings.insertComment(
 state.currentSection.id,
 state.activeItemId,
 sel.text,
 );
 if ('id' in sel && sel.id) comments.touchSnippet(sel.id as string);
 state.setShowCommentLibrary(false);
 }
 },
 onLibraryClose: () => state.setShowCommentLibrary(false),
 onPhoto: () => {
 if (!state.activeItemId || uploadFetcher.state !== "idle") return;
 // Task 16 — desktop file pickers already offer camera-vs-library choice
 // natively, so go straight to the multi-select library input; mobile
 // still needs the explicit chooser (camera capture has no multi-select).
 if (isMobile) {
 setAddMediaChooser({ itemId: state.activeItemId });
 } else {
 libraryInputRef.current?.click();
 }
 },
 onSave: () => findings.saveNow(),
 onPublish: () => { setPublishError(null); state.setShowPublishModal(true); },
 onCloneLast: () => handleCloneLast(inspectionPrefs.cloneDefault),
 onSaveAsSnippet: () => {
 if (!state.activeItemId) return;
 const r = state.getResult(state.activeItemId);
 const notes = ((r?.notes as string) || "").trim();
 if (!notes) return;
 const severity = state.severityForRatingId(r?.rating as string);
 const section = state.currentSection?.title || "";
 comments.saveSnippet(notes, severity, section, undefined, (state.activeItem?.label || state.activeItem?.name || undefined) as string | undefined);
 },
 onToggleCheatsheet: () =>
 state.setShowCheatsheet(!state.showCheatsheet),
 onGotoSection: (idx: number) => {
 if (idx >= 0 && idx < state.sections.length) {
 state.selectSection(idx);
 }
 },
 onOpenSectionPicker: () => state.openSectionPicker(),
 onOpenTagPicker: () => {
 if (!state.activeItemId) return;
 setTagPickerOpen(true);
 },
 onToggleFullscreen: () => state.setItemFullscreen(!state.itemFullscreen),
 onExitFullscreen: () => { if (state.itemFullscreen) state.setItemFullscreen(false); }, // guard: bare Escape (not fullscreen) = no-op
 }),
 [
 state,
 findings,
 handleRating,
 toggleSpeedMode,
 speedRate,
 openSnippets,
 comments,
 commentLibraryItems,
 serverComments,
 uploadFetcher.state,
 isMobile,
 ],
 );

 useKeyboard(keyboardHandlers, true);

 /* ---------------------------------------------------------------- */
 /* Visible items (filtered + searched) */
 /* ---------------------------------------------------------------- */

 const visibleItems = useMemo(() => {
 return state.currentSectionItems.filter((item) => {
 if (!state.itemPassesFilter(item, state.currentSection?.id)) return false;
 if (
 state.searchNeedle &&
 !state.itemMatchesSearch(state.currentSection, item)
 )
 return false;
 return true;
 });
 }, [state]);

 /* ---------------------------------------------------------------- */
 /* Hoisted column elements (shared between desktop + mobile shells) */
 /* ---------------------------------------------------------------- */

 const sectionRailEl = (
 <SectionRail
 mode="fill"
 sections={state.sections}
 activeSection={state.currentSection?.id || ""}
 onSelect={(id) => {
 state.selectSectionById(id);
 state.setActiveView("items");
 if (isMobile) setMobileDrawer(null);
 }}
 results={state.results}
 activeUnitId={activeUnitId}
 sectionProgress={state.sectionProgress}
 sectionDefectCount={state.sectionDefectCount}
 overviewActive={state.activeView === "property"}
 onSelectOverview={() => state.setActiveView("property")}
 onAddSection={structure.addSection}
 onDuplicateSection={structure.duplicateSection}
 onDeleteSection={structure.deleteSection}
 onMoveSection={structure.moveSection}
 onReorderSection={structure.reorderSection}
 onRenameSection={structure.renameSection}
 />
 );

 const itemListEl = (
 <ItemList
 mode="fill"
 items={visibleItems}
 sectionId={state.currentSection?.id || ""}
 activeItemId={state.activeItemId}
 onSelect={(id) => {
 state.setActiveItemId(id);
 if (isMobile) setMobileDrawer(null);
 }}
 results={state.results}
 activeUnitId={activeUnitId}
 batchMode={state.batchMode}
 batchSelected={state.batchSelected}
 onBatchToggle={(id) => state.toggleBatchSelect(id)}
 onBatchRange={(from, to) => state.batchSelectRange(from, to)}
 onAddItem={() => structure.openAddItemPrompt(state.currentSection?.id || "")}
 onDuplicateItem={(itemId) => structure.duplicateItem(state.currentSection?.id || "", itemId)}
 onDeleteItem={(itemId) => structure.deleteItem(state.currentSection?.id || "", itemId)}
 onMoveItem={(itemId, dir) => structure.moveItem(state.currentSection?.id || "", itemId, dir)}
 onReorderItem={(fromId, toId) => reorderItemBySwap(state.currentSectionItems, fromId, toId, state.currentSection?.id || "", structure.moveItem)}
 onRenameItem={(itemId, label) => structure.renameItem(state.currentSection?.id || "", itemId, label)}
 />
 );

 const itemEditorEl = state.activeItemId ? (
 <ItemEditor
 item={state.activeItem || undefined}
 sectionTitle={state.currentSection?.title}
 result={
 state.activeItemId
 ? findings.getResult(
 state.activeItemId,
 state.currentSection?.id,
 )
 : {}
 }
 ratingLevels={state.ratingLevels}
 onRating={handleRating}
 onAddPhoto={() =>
  state.activeItemId
   ? setAddMediaChooser({ itemId: state.activeItemId })
   : libraryInputRef.current?.click()
 }
 onAddDefectPhoto={(target) => {
 if (uploadFetcher.state !== "idle") return;
 pendingPhotoTargetRef.current = target;
 // Task 16 — same camera/library split as onPhoto above, scoped to a
 // specific defect row instead of the item.
 if (isMobile) {
 setAddMediaChooser({ itemId: state.activeItemId ?? "" });
 } else {
 libraryInputRef.current?.click();
 }
 }}
 photoUploading={uploadFetcher.state !== "idle"}
 onAddCustomDefect={(input) => {
 if (state.activeItemId && state.currentSection) {
 const d = makeCustomDefect(input);
 if (d) {
 findings.addCustomDefect(state.currentSection.id, state.activeItemId, {
 ...d,
 comment: d.comment ?? "",
 });
 }
 }
 }}
 onToggleCustomDefect={(customId, included) => {
 if (state.activeItemId && state.currentSection) {
 findings.toggleCustomDefect(
 state.currentSection.id,
 state.activeItemId,
 customId,
 included,
 );
 }
 }}
 onNotes={(notes) => {
 if (state.activeItemId && state.currentSection) {
 findings.setNotes(
 state.currentSection.id,
 state.activeItemId,
 notes,
 );
 }
 }}
 onNotesBlur={(notes) => {
 if (state.activeItemId && state.currentSection) {
 findings.commitNotes(
 state.currentSection.id,
 state.activeItemId,
 notes,
 );
 }
 }}
 onValue={(value) => {
 if (state.activeItemId && state.currentSection) {
 findings.setItemValue(
 state.currentSection.id,
 state.activeItemId,
 value,
 );
 }
 }}
 onToggleCanned={(tabName, cannedId, included) => {
 if (state.activeItemId && state.currentSection) {
 findings.toggleCannedComment(
 state.currentSection.id,
 state.activeItemId,
 tabName,
 cannedId,
 included,
 );
 }
 }}
 defectStates={defectStates}
 locationSuggestions={locationSuggestions}
 missingFields={missingFields}
 requiredDefectFields={requiredDefectFields}
 categoryColor={catColor}
 onDefectFields={(cannedId, patch) => {
 if (state.activeItemId && state.currentSection) {
 findings.setDefectFields(
 state.currentSection.id,
 state.activeItemId,
 cannedId,
 patch,
 );
 }
 }}
 onItemAttribute={handleItemAttribute}
 onCloneLast={handleCloneLast}
 cloneDefaultScope={inspectionPrefs.cloneDefault}
 tagChipRow={tagChipRow}
 onOpenSnippets={openSnippets}
 onSearchLibrary={comments.searchLibrary}
 onSaveDefectToLibrary={(input) => {
 // Track H (B-20 回流): best-effort — the defect itself already landed in
 // result.customComments; a failed library save only costs reuse next time.
 const text = input.comment ? `${input.title} — ${input.comment}` : input.title;
 comments.saveSnippet(
 text,
 "significant",
 state.currentSection?.title || "",
 undefined,
 (state.activeItem?.label || state.activeItem?.name || undefined) as string | undefined,
 ).then((ok) => {
 if (!ok) pushToast({ message: m.editor_route_defect_library_copy_failed(), variant: "warning", durationMs: 6000 });
 });
 }}
 queuedPreviews={[]}
 attachedRepairItems={
 (state.activeItemId
 ? (findings.getResult(state.activeItemId, state.currentSection?.id)
 .recommendations as AttachedRepairItem[] | undefined)
 : undefined) ?? []
 }
 onAttachRepairItem={findings.attachRepairItem}
 onDetachRepairItem={findings.detachRepairItem}
 inspectionId={String(state.inspection.id)}
 coverKey={coverKey}
 onOpenPhoto={onOpenPhoto}
 onReorderPhotos={onReorderPhotos}
 onBulkDetachPhotos={onBulkDetachPhotos}
 moveTargets={moveTargets}
 onBulkMovePhotos={onBulkMovePhotos}
 videoPosterUrl={videoPosterUrl}
 pendingPhotoUrl={pendingPhotoUrl}
 />
 ) : (
 <div className="flex items-center justify-center h-full text-ih-fg-4">
 <div className="text-center">
 <p className="text-[13px]">
 {m.editor_route_select_item_hint()}
 </p>
 <p className="text-[11px] mt-2 text-ih-fg-4">
 {m.editor_route_navigate_hint_press()} <kbd className="px-1.5 py-0.5 bg-ih-bg-muted rounded text-[10px] font-mono border">J</kbd> / <kbd className="px-1.5 py-0.5 bg-ih-bg-muted rounded text-[10px] font-mono border">K</kbd> {m.editor_route_navigate_hint_navigate()}
 </p>
 </div>
 </div>
 );

 const sideRailEl = (
 <SideRail
 locale={displayLocale}
 mode="fill"
 activeItem={state.activeItem ? { id: state.activeItem.id, label: (state.activeItem.label || state.activeItem.name || "") as string, type: state.activeItem.type } : null}
 activeResult={state.activeItemId ? state.getResult(state.activeItemId) : null}
 ratingLevels={state.ratingLevels}
 getRatingColor={state.getRatingColor}
 getRatingLabel={state.getRatingLabel}
 inspectionId={String(state.inspection.id)}
 photoCount={inspectionPhotoCount}
 onGallerySetCover={(p) => setGalleryCropSource(p)}
 onGalleryAnnotate={(p) => openPhotoStudio({ url: p.url, key: p.key, index: 0, total: 0 })}
 serverComments={serverComments}
 librarySort={comments.sort}
 onLibrarySearch={(q) => state.setCommentLibrarySearch(q)}
 onLibraryInsert={(text, id) => {
 if (!state.activeItemId || !state.currentSection) return;
 onInsert(state.currentSection.id, state.activeItemId, text);
 comments.touchSnippet(id);
 }}
 onLibraryTabChange={(isOpen) => setLibrarySideOpen(isOpen)}
 categoryColor={catColor}
 />
 );

 /* B-22: empty-template CTA — shown instead of normal editor body when the
  * inspection has no sections (template not applied yet). Opens the
  * InspectionSettingsSheet where the user can pick a template. */
 const emptyTemplateEl = state.sections.length === 0 ? (
 <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-6">
  <p className="text-[15px] font-semibold text-ih-fg-1">{m.editor_route_empty_template_title()}</p>
  <p className="text-[13px] text-ih-fg-3 max-w-sm">{m.editor_route_empty_template_desc()}</p>
  <Button
  variant="primary"
  onClick={() => state.setSettingsOpen(true)}
  >
  {m.editor_route_choose_template()}
  </Button>
 </div>
 ) : null;

 // Task 16 — hoisted so the SAME elements mount in both the mobile and
 // desktop render trees below (they're two separate early-return JSX trees,
 // not nested). FE-2 already hit this bug once for the old single photo
 // input (see the comment that used to sit here): a ref/overlay defined only
 // in the desktop tree is simply null/absent on mobile, so any handler that
 // targets it silently no-ops. camera/library inputs feed handlePhotoUpload
 // directly; the add-media chooser (camera vs library vs video) and the
 // video-capture overlay it can open must mount on both surfaces too, since
 // onPhoto/onAddPhoto/onAddDefectPhoto now route mobile through the chooser.
 const photoInputsEl = (
 <>
 <input
 ref={cameraInputRef}
 type="file"
 accept="image/*"
 capture="environment"
 className="hidden"
 onChange={handlePhotoUpload}
 />
 <input
 ref={libraryInputRef}
 type="file"
 accept="image/*"
 multiple
 className="hidden"
 onChange={handlePhotoUpload}
 />
 </>
 );

 const addMediaOverlaysEl = (
 <>
 {/* Plan 7 — add-media chooser: take a photo, add from library, or video.
 * Video requires a connection (no offline queue); the Video option
 * disables + hints when offline. */}
 {addMediaChooser && (
 <AddMediaChooser
 onClose={() => setAddMediaChooser(null)}
 onTakePhoto={() => {
 setAddMediaChooser(null);
 cameraInputRef.current?.click();
 }}
 onAddFromLibrary={() => {
 setAddMediaChooser(null);
 libraryInputRef.current?.click();
 }}
 onPickVideo={() => {
 const t = addMediaChooser;
 setAddMediaChooser(null);
 setVideoCaptureTarget(t);
 }}
 />
 )}

 {/* Plan 7 — video capture + pluggable backend upload overlay. */}
 {videoCaptureTarget && (
 <VideoCapture
 inspectionId={String(state.inspection.id)}
 provider={videoProvider}
 itemId={videoCaptureTarget.itemId}
 onClose={() => setVideoCaptureTarget(null)}
 onUploaded={() => {
 setVideoCaptureTarget(null);
 revalidator.revalidate();
 }}
 />
 )}
 </>
 );

 /* ---------------------------------------------------------------- */
 /* Render */
 /* ---------------------------------------------------------------- */

 if (isMobile) {
 return (
 <div className="min-h-screen pb-14">
 {photoInputsEl}
 {addMediaOverlaysEl}
 <MobileAppBar
 sectionTitle={state.currentSection?.title ?? ''}
 itemLabel={((state.activeItem?.label || state.activeItem?.name) as string | undefined) ?? m.editor_route_select_an_item()}
 onBack={() => {
  // B-22: back from item editor → item list; back from list → inspections
  if (state.activeItemId) { state.setActiveItemId(null); return; }
  navigate('/inspections');
 }}
 onMore={() => { /* future: open more menu */ }}
 />
 <main className="p-4">
 {emptyTemplateEl ?? (state.activeItemId ? (
  itemEditorEl
 ) : (
  <p className="text-center text-ih-fg-3 mt-12">{m.editor_route_mobile_begin()}</p>
 ))}
 </main>
 <MobileDrawerTriggers onOpen={(id) => setMobileDrawer(id)} />
 <MobileBottomDrawer
 open={mobileDrawer === 'sections'}
 onClose={() => setMobileDrawer(null)}
 title={m.editor_route_drawer_sections()}
 >
 {sectionRailEl}
 </MobileBottomDrawer>
 <MobileBottomDrawer
 open={mobileDrawer === 'items'}
 onClose={() => setMobileDrawer(null)}
 title={m.editor_route_drawer_items()}
 >
 {itemListEl}
 </MobileBottomDrawer>
 <MobileBottomDrawer
 open={mobileDrawer === 'preview'}
 onClose={() => setMobileDrawer(null)}
 title={m.editor_route_drawer_preview()}
 >
 {sideRailEl}
 </MobileBottomDrawer>
 {/* Theme — narrow-screen home for the theme control the xl+ header shows
     inline, so the auto/light/dark/field preference is reachable on tablet
     and phone too. */}
 <MobileBottomDrawer
 open={mobileDrawer === 'theme'}
 onClose={() => setMobileDrawer(null)}
 title={m.nav_theme_label()}
 >
 <div className="p-4">
  <ThemeSegmentControl />
 </div>
 </MobileBottomDrawer>
 </div>
 );
 }

 return (
 <div
  /* Desktop editor minimum design width 1024px (iPad landscape fits without
     scroll; real phones/small tablets never reach here — the isMobile branch
     above owns <768px). Below 1024 the whole editor scrolls horizontally
     instead of squeezing the fixed-width rails; the fixed header/footer stay
     pinned to the viewport and always cover the visible area. */
  className="flex h-screen bg-ih-bg-card overflow-x-auto"
 >
 {photoInputsEl}

 {/* SpeedMode overlay */}
 {state.speedMode && speedItem && (
 <SpeedMode
 item={{
 id: speedItem.id,
 label: speedItem.label,
 type: "rich",
 }}
 sectionTitle={speedItem.sectionName}
 result={state.getResult(speedItem.id)}
 onRating={(rating) => {
 const levelIdx = state.ratingLevels.findIndex(
 (l) => l.id === rating,
 );
 if (levelIdx >= 0) speedRate(levelIdx);
 }}
 onPrev={speedPrev}
 onNext={speedNext}
 onExit={() => state.setSpeedMode(false)}
 currentIndex={state.speedCurrent}
 totalCount={state.speedQueue.length}
 onNextItem={speedNext}
 onPrevItem={speedPrev}
 onJumpTo={(sectionId, itemId) => {
 state.selectSectionById(sectionId);
 state.setActiveItemId(itemId);
 state.setSpeedMode(false);
 }}
 ratingLevels={state.ratingLevels}
 sections={state.sections as Array<{ id: string; title?: string; name?: string; items?: Array<{ id: string; label?: string; name?: string }> }>}
 />
 )}

 {/* Keyboard cheatsheet overlay */}
 {state.showCheatsheet && <KeyboardHud onClose={() => state.setShowCheatsheet(false)} />}

 {/* Burst camera overlay */}
 <BurstCamera
 open={state.burstCameraOpen}
 onClose={() => {
 state.setBurstCameraOpen(false);
 state.setBurstCameraItemId(null);
 }}
 onCommit={handleBurstCommit}
 />

 {/* Photo studio overlay */}
 <PhotoAnnotator
 open={photoStudioOpen}
 photoUrl={photoStudioUrl}
 photoIndex={photoStudioIndex}
 totalPhotos={photoStudioTotal}
 sectionName={state.currentSection?.title || state.currentSection?.name || ""}
 initialAnnotationsJson={null}
 isCover={!!photoStudioKey && (state.inspection.coverPhotoId as string | null) === photoStudioKey}
 onSetCover={photoStudioKey ? () => {
  const isCover = (state.inspection.coverPhotoId as string | null) === photoStudioKey;
  coverFetcher.submit(
   { intent: "set-cover", coverPhotoId: isCover ? "" : photoStudioKey },
   { method: "post" },
  );
 } : undefined}
 onSave={({ blob, nodesJson }) => {
  const itemId = state.activeItemId;
  if (itemId && photoStudioIndex != null) {
   const sectionId = state.currentSection?.id;
   // #181 — the Y.Doc owns results.data: bake the annotation PNG to R2 + mirror
   // the returned annotatedKey into the doc (offline refuses with a toast).
   // performPhotoAnnotationSave returns false only in the brief pre-connect
   // window before the doc is live; fall back to the online annotate relay then.
   if (!performPhotoAnnotationSave({ itemId, photoIndex: photoStudioIndex, sectionId }, blob, nodesJson)) {
    const fd = new FormData();
    fd.append("intent", "annotate");
    fd.append("itemId", itemId);
    fd.append("photoIndex", String(photoStudioIndex));
    fd.append("nodes", nodesJson);
    if (sectionId) fd.append("sectionId", sectionId);
    fd.append("image", new File([blob], "annotated.png", { type: "image/png" }));
    coverFetcher.submit(fd, { method: "post", encType: "multipart/form-data" });
   }
  }
  setPhotoStudioOpen(false);
 }}
 onClose={() => setPhotoStudioOpen(false)}
 />

 {/* Task 8 — unified MediaViewer for an item's photo strip (tap a thumbnail
  * to open; the bottom toolbar routes cover/annotate/revert/delete to the
  * per-photo endpoints; crop opens the PhotoCropper, rotate/caption are no-ops). */}
 <MediaViewer
 photos={viewer.index !== null ? itemGalleryPhotos(viewer.itemId) : []}
 index={viewer.index}
 onClose={() => setViewer((v) => ({ ...v, index: null }))}
 onAction={onViewerAction}
 streamCustomerSubdomain={streamCustomerSubdomain}
 inspectionId={String(state.inspection.id)}
 />

 {/* Plan 7 — poster-frame picker for a video entry (opened by the "Poster
  * frame" toolbar action). Fails closed when the Stream subdomain is absent. */}
 {posterTarget && (
 <PosterPicker
  inspectionId={String(state.inspection.id)}
  streamUid={posterTarget.streamUid}
  durationSec={posterTarget.durationSec}
  posterPct={posterTarget.posterPct}
  streamCustomerSubdomain={streamCustomerSubdomain}
  onClose={() => setPosterTarget(null)}
 />
 )}

 {addMediaOverlaysEl}

 {/* Plan 4 (Task 8) — per-photo crop overlay. Cropping ALWAYS re-derives from
  * the ORIGINAL key. A re-crop that would discard an existing annotation warns
  * first (no native window.confirm). */}
 {photoCropTarget && (
 <PhotoCropper
  sourceUrl={fullResUrl(photoCropTarget.sourceUrl)}
  allowFree
  title={m.editor_route_crop_photo()}
  saveLabel={m.editor_route_save_crop()}
  onCancel={() => setPhotoCropTarget(null)}
  onSave={(blob, crop) => {
   const target = photoCropTarget;
   setPhotoCropTarget(null);
   const run = () => performPhotoCropSave(target, blob, crop);
   if (target.hasAnnotation) setRecropWarn({ run });
   else run();
  }}
 />
 )}

 {/* Plan 4 — re-crop warning modal (annotation will be discarded). */}
 <RecropWarningModal
 open={Boolean(recropWarn)}
 onCancel={() => setRecropWarn(null)}
 onConfirm={() => { const r = recropWarn?.run; setRecropWarn(null); r?.(); }}
 />

 {/* D8 — structural delete confirmation modal (section OR item; NEVER window.confirm). */}
 <StructureDeleteModal
  open={Boolean(structure.deletePending)}
  title={structure.deletePending?.title ?? ""}
  noun={structure.deletePending?.kind ?? "section"}
  impact={structure.deletePending?.impact ?? { items: 0, ratings: 0, notes: 0, photos: 0 }}
  onCancel={structure.cancelDelete}
  onConfirm={structure.confirmDelete}
 />

 {/* D8 — "Add section" title prompt. */}
 <AddSectionPromptModal
  open={structure.addSectionPromptOpen}
  value={structure.addSectionTitle}
  onChange={structure.setAddSectionTitle}
  onConfirm={structure.submitAddSection}
  onCancel={structure.closeAddSectionPrompt}
 />

 {/* D8 — "Add item" type-picker. */}
 <AddItemTypeModal
  open={Boolean(structure.addItemPending)}
  onConfirm={structure.submitAddItem}
  onCancel={structure.closeAddItemPrompt}
 />

 {/* D8 — save structure to template / as new template. */}
 <SaveTemplateModal
  mode={structure.saveTemplatePending?.mode ?? null}
  name={structure.saveTemplateName}
  onChangeName={structure.setSaveTemplateName}
  onConfirm={structure.submitSaveTemplate}
  onCancel={structure.closeSaveTemplate}
 />

 {/* Inspection settings sheet */}
 <InspectionSettingsSheet
 open={state.settingsOpen}
 onClose={() => state.setSettingsOpen(false)}
 inspectionId={String(state.inspection.id)}
 // Template schema drives the whole editor state (frozen at mount in useInspection),
 // so a template change requires a full route reload — this also fixes the same
 // staleness for mid-inspection template switches, not just the empty case.
 onTemplateApplied={() => window.location.reload()}
 />

 {/* Media Studio — gallery "Set as cover" crop overlay */}
 {galleryCropSource && (
 <CoverCropper
  sourceUrl={fullResUrl(galleryCropSource.url)}
  sourceKey={galleryCropSource.key}
  onCancel={() => setGalleryCropSource(null)}
  onSave={(blob, c) => {
   const fd = new FormData();
   fd.append("intent", "crop-cover");
   fd.append("sourceKey", galleryCropSource.key);
   fd.append("crop", JSON.stringify({ aspect: c.aspect, orientation: c.orientation, ...c.pixels }));
   fd.append("image", new File([blob], "cover.jpg", { type: "image/jpeg" }));
   coverFetcher.submit(fd, { method: "post", encType: "multipart/form-data" });
   setGalleryCropSource(null);
  }}
 />
 )}

 {/* Unsaved changes blocker dialog */}
 <UnsavedChangesBlocker
 open={blocker.state === "blocked"}
 onStay={cancelLeave}
 onLeave={confirmLeave}
 />

 {/* Publish confirmation modal */}
 <PublishModal
 open={state.showPublishModal}
 progress={{ rated: state.progress.rated, total: state.progress.total, pct: state.progress.pct }}
 status={state.inspection.status as string}
 publishError={publishError}
 isSubmitting={publishFetcher.state !== "idle"}
 onClose={() => { setPublishError(null); state.setShowPublishModal(false); }}
 onPublish={() => {
 // Keep the modal open: the publish-result effect closes it on success
 // and shows the real server reason inline on failure.
 setPublishError(null);
 publishFetcher.submit({ intent: "publish" }, { method: "post" });
 }}
 autoSign={autoSign}
 onAutoSignToggle={handleAutoSignToggle}
 />

 {/* #181 — Version history panel (collab Phase 4). Only reachable when the
     collabEditing flag is on (the trigger button is gated in EditorHeader).
     Live convergence for ALL clients (incl. the initiator) is now driven by the
     DO's MSG_RESTORE control frame (Task 12b): each client drops its local Y.Doc
     + IndexedDB and resyncs. The onRestored revalidate below is belt-and-braces —
     it refreshes loader data for the non-collab projection path. */}
 <VersionHistoryPanel
 open={versionHistoryOpen}
 onClose={() => setVersionHistoryOpen(false)}
 inspectionId={String(loaderData.inspection.id)}
 onRestored={() => { revalidator.revalidate(); }}
 doc={collab?.doc ?? null}
 currentResults={state.results as unknown as ResultsProjection}
 />

 {/* Inspector sign modal */}
 <SignModal
 open={signModalOpen}
 onSubmit={handleSignSubmit}
 onCancel={() => setSignModalOpen(false)}
 failed={Boolean(signFetcher.data && !(signFetcher.data as { ok: boolean }).ok)}
 />

 {/* Comment library drawer */}
 <CommentLibraryDrawer
 open={state.showCommentLibrary}
 comments={{
 filterMode: comments.filterMode,
 setFilterMode: comments.setFilterMode,
 sort: comments.sort,
 setSort: comments.setSort,
 touchSnippet: comments.touchSnippet,
 }}
 state={{
 activeItem: state.activeItem,
 currentSection: state.currentSection,
 activeItemId: state.activeItemId,
 getResult: state.getResult,
 getRatingLabel: state.getRatingLabel,
 commentLibraryFilter: state.commentLibraryFilter,
 setCommentLibraryFilter: state.setCommentLibraryFilter,
 setCommentLibrarySelectedIdx: state.setCommentLibrarySelectedIdx,
 commentLibrarySearch: state.commentLibrarySearch,
 setCommentLibrarySearch: state.setCommentLibrarySearch,
 commentLibrarySelectedIdx: state.commentLibrarySelectedIdx,
 setShowCommentLibrary: state.setShowCommentLibrary,
 }}
 serverComments={serverComments}
 onInsert={onInsert}
 onClose={() => state.setShowCommentLibrary(false)}
 />

 {/* Section picker modal */}
 <SectionPickerModal
 open={state.sectionPickerOpen}
 sectionPickerQuery={state.sectionPickerQuery}
 setSectionPickerQuery={state.setSectionPickerQuery}
 filteredSectionsForPicker={state.filteredSectionsForPicker}
 sections={state.sections}
 pickSection={state.pickSection}
 closeSectionPicker={state.closeSectionPicker}
 />

 {/* Tag picker modal */}
 <TagPickerModal
  open={tagPickerOpen && Boolean(state.activeItemId)}
  activeItemId={state.activeItemId ?? ""}
  tagsByItem={state.tagsByItem}
  presetTags={PRESET_TAGS}
  onToggle={toggleTag}
  onClose={() => setTagPickerOpen(false)}
 />

 {/* Publish gate modal */}
 <PublishGateModal
  open={showPublishGate}
  readiness={publishReadiness}
  onClose={() => setShowPublishGate(false)}
  onProceed={() => {
   // IA-7 warning mode — user acknowledged the soft gaps.
   setPublishError(null);
   setShowPublishGate(false);
   state.setShowPublishModal(true);
  }}
  onJump={(b: PublishBlockingDefect) => {
   state.selectSectionById(b.sectionId);
   state.setActiveItemId(b.itemId);
   setShowPublishGate(false);
   setTimeout(() => {
    const sel = b.missing[0] === 'trade' ? 'select' : 'input[type="text"]';
    const el = document.querySelector<HTMLElement>(`[data-defect-id="${b.cannedId}"] ${sel}`);
    if (el) el.focus();
   }, 100);
  }}
 />

 {/* ------------------------------------------------------------ */}
 {/* Fixed top header with progress bar */}
 {/* ------------------------------------------------------------ */}
 <EditorHeader
 state={state}
 tenantSlug={loaderData.tenantSlug}
 setSignModalOpen={setSignModalOpen}
 handlePublishClick={handlePublishClick}
 collabEditing={loaderData.collabEditing}
 onOpenVersionHistory={() => setVersionHistoryOpen(true)}
 onChangeTemplate={() => state.setSettingsOpen(true)}
 onSaveAsNewTemplate={() => structure.openSaveTemplate("new")}
 onUpdateSourceTemplate={() => structure.openSaveTemplate("back")}
 canUpdateSourceTemplate={structure.canSaveBack}
 perUnitControls={
  showUnitsSurface ? (
   <div className="flex items-center gap-2">
    {isPerUnit && (
      <BreadcrumbDropdown units={units} activeUnitId={activeUnitId} onSelect={requestScope} />
    )}
    <Button
     variant="secondary"
     size="sm"
     onClick={() => setUnitsManagerOpen(true)}
     className="hidden lg:inline-flex"
     title={m.editor_route_manage_units()}
     icon={
      <svg className="w-3.5 h-3.5 text-ih-fg-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
      </svg>
     }
    >
     {m.editor_route_units()}
    </Button>
    <Button
     variant="secondary"
     size="sm"
     onClick={() => setCostItemsOpen(true)}
     className="hidden lg:inline-flex"
     title={m.editor_route_cost_items_title()}
     icon={
      <svg className="w-3.5 h-3.5 text-ih-fg-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.66 0-3 .9-3 2s1.34 2 3 2 3 .9 3 2-1.34 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V6m0 12v-2m0-10a4 4 0 100 8 4 4 0 000-8z" />
      </svg>
     }
    >
     {m.editor_route_cost_items()}
    </Button>
   </div>
  ) : undefined
 }
 />
 {/* Commercial PCA Phase U (Batch C2b) — units management drawer */}
 {showUnitsSurface && (
  <UnitsManager
   open={unitsManagerOpen}
   onClose={() => setUnitsManagerOpen(false)}
   inspectionId={String(state.inspection.id)}
   units={units}
   mode={unitInspectionMode}
   fetcher={unitsFetcher}
  />
 )}
 {/* Commercial PCA Phase C Task 13b — cost items drawer (Opinion of Cost) */}
 {showUnitsSurface && (
  <CostItemsHost
   open={costItemsOpen}
   onClose={() => setCostItemsOpen(false)}
   inspectionId={String(state.inspection.id)}
  />
 )}
 {/* ------------------------------------------------------------ */}
 {/* 4-column layout below header */}
 {/* ------------------------------------------------------------ */}
 <div className="flex flex-1 pt-14 pb-9 min-w-[1024px]">
 {/* B-22: if no sections, show the empty-template CTA spanning the full body */}
 {emptyTemplateEl ? (
 <div className="flex-1 flex">
  {emptyTemplateEl}
 </div>
 ) : (
 <>
 {/* Column 1: Section Rail (200px) — hidden in fullscreen */}
 {!state.itemFullscreen && sectionRailEl}

 {/* Column 2: Item List (280px, items-only) — hidden in fullscreen */}
 {!state.itemFullscreen && (
 <div className="w-[280px] flex-shrink-0 border-r border-ih-border flex flex-col overflow-hidden relative">
 {/* Item filter tabs */}
 <div className="flex items-center gap-1 px-3 py-1.5 border-b border-ih-border">
 <SegmentedControl
 ariaLabel={m.editor_route_item_filter()}
 value={state.itemFilter}
 onChange={(v) => state.setItemFilter(v as ItemFilter)}
 options={(["all", "unrated", "issues", "flagged"] as const).map((f) => ({
 value: f,
 label: (
 <>
 {f === "all" ? m.editor_route_filter_all() : f === "unrated" ? m.editor_route_filter_unrated() : f === "issues" ? m.editor_route_filter_issues() : m.editor_route_filter_flagged()}
 {f !== "all" && (
 <span className="ml-1 text-[10px]">
 {f === "unrated" ? state.filterCounts.unrated : f === "issues" ? state.filterCounts.issues : state.filterCounts.flagged}
 </span>
 )}
 </>
 ),
 }))}
 />
 {/* Batch mode toggle — object-scoped action, lives with the items it selects
     (moved out of the global header). */}
 <IconButton
 onClick={() => {
  if (state.batchMode) {
  state.setBatchMode(false);
  state.setBatchSelected({});
  } else {
  state.setBatchMode(true);
  }
 }}
 selected={state.batchMode}
 size="sm"
 className="ml-auto"
 title={state.batchMode ? m.editor_route_exit_batch_mode() : m.editor_route_batch_mode()}
 aria-label={state.batchMode ? m.editor_route_exit_batch_mode() : m.editor_route_batch_select_items()}
 >
 <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
 </svg>
 </IconButton>
 </div>
 {itemListEl}
 </div>
 )}

 {/* Column 3: Item Editor (flex-1, focal) or Inspection Details overview — always rendered */}
 <div className="flex-1 min-w-0 relative flex flex-col border-t-2 border-ih-primary">
 {/* Fullscreen toggle — object-scoped action (focuses the item editor); pinned
     to the pane top-right, outside the scroll area. Hidden in the property
     overview. Serves as the exit affordance while in fullscreen too. */}
 {state.activeView !== "property" && (
  <div className="absolute top-2.5 right-2.5 z-10">
  <FullscreenToggle active={state.itemFullscreen} onToggle={() => state.setItemFullscreen(!state.itemFullscreen)} />
  </div>
 )}
 <main className="flex-1 overflow-y-auto p-6">
 {state.activeView === "property" ? (
  <>
  <PropertyInfoForm
  inspection={state.inspection}
  templateFields={activePropertyPreset}
  onSave={(fieldId, value) => {
  state.setInspection((prev) => ({
   ...prev,
   [fieldId]: value,
  }));
  }}
  onCommit={savePropertyFacts}
  />
  {/* Commercial PCA Phase T — subtype + report tier selectors. Gated on the
     same propertyType === 'commercial' flag section-applicability.ts uses
     to decide PCA-only sections apply. Sits above the narrative panel so
     the subtype (which the Building Profile / cost tables key off) is set
     before the inspector writes narrative for a specific tier. */}
  {(state.inspection as Record<string, unknown>).propertyType === "commercial" ? (
   <div className="mt-8 border-t border-ih-border pt-6">
    <CommercialReportControls
     commercialSubtype={((state.inspection as Record<string, unknown>).commercialSubtype as string | null | undefined) ?? null}
     reportTier={((state.inspection as Record<string, unknown>).reportTier as ReportTier | null | undefined) ?? null}
     saving={subtypeFetcher.state !== "idle" || tierFetcher.state !== "idle"}
     onChangeSubtype={(subtype) => {
      state.setInspection((prev) => ({ ...prev, commercialSubtype: subtype }));
      saveSubtype(subtype);
     }}
     onChangeTier={(tier) => {
      state.setInspection((prev) => ({ ...prev, reportTier: tier }));
      saveTier(tier);
     }}
    />
   </div>
  ) : null}
  {/* Commercial PCA Phase S — narrative editor panel. Gated on the same
     propertyType === 'commercial' flag section-applicability.ts uses to
     decide PCA-only sections apply. */}
  {(state.inspection as Record<string, unknown>).propertyType === "commercial" ? (
   <div className="mt-8 border-t border-ih-border pt-6">
    <PcaNarrativePanel
     narrative={loaderData.pcaNarrative}
     onSave={saveNarrative}
     saving={narrativeFetcher.state !== "idle"}
    />
   </div>
  ) : null}
  {/* Commercial PCA Phase M Task 10 — compliance panel (dual sign-off / PSQ /
     doc-review checklist / conformance preview). Rendered ONLY at
     reportTier === 'full_pca' — a light_commercial report has no compliance
     surface (the Task 6 API 409s writes at any other tier). Self-manages its
     own fetchers/intents; the loader only supplies the read-side artifacts. */}
  {(state.inspection as Record<string, unknown>).propertyType === "commercial" &&
   ((state.inspection as Record<string, unknown>).reportTier as ReportTier | null | undefined) === "full_pca" ? (
   <div className="mt-8 border-t border-ih-border pt-6">
    <CompliancePanel
     inspectionId={String(state.inspection.id)}
     data={{ ...loaderData.compliance, relianceText: loaderData.relianceText }}
    />
   </div>
  ) : null}
  </>
 ) : itemEditorEl}
 </main>
 </div>

 {/* Column 4: SideRail — hidden in fullscreen; collapsible otherwise */}
 {!state.itemFullscreen && (
  state.sideRailCollapsed ? (
  <div className="w-8 flex-shrink-0 border-l border-ih-border flex flex-col items-center pt-3">
   <IconButton
   aria-label={m.editor_route_expand_photo_rail()}
   onClick={() => state.setSideRailCollapsed(false)}
   size="sm"
   title={m.editor_route_expand_photo_rail()}
   >
   <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
   </svg>
   </IconButton>
  </div>
  ) : (
  <div className="relative flex-shrink-0">
   <IconButton
   aria-label={m.editor_route_collapse_photo_rail()}
   onClick={() => state.setSideRailCollapsed(true)}
   size="sm"
   className="absolute top-3 left-1 z-10 w-6 h-6"
   title={m.editor_route_collapse_photo_rail()}
   >
   <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
   </svg>
   </IconButton>
   {sideRailEl}
  </div>
  )
 )}
 </>
 )}
 </div>

 {/* ------------------------------------------------------------ */}
 {/* Batch Action Bar — spans full editor width, shown when items are selected */}
 {/* ------------------------------------------------------------ */}
 {state.batchMode && state.selectedBatchCount > 0 && (
 <BatchActionBar
  count={state.selectedBatchCount}
  ratingLevels={state.ratingLevels.slice(0, 5)}
  getRatingColor={state.getRatingColor}
  onSelectAll={() => state.batchSelectAll()}
  onClear={() => state.setBatchSelected({})}
  onSetRating={(levelId) => {
   const sectionId = state.currentSection?.id || "";
   const selectedIds = Object.keys(state.batchSelected).filter((id) => state.batchSelected[id]);
   const prior = capturePriorRatings(selectedIds, (id) => {
    const r = state.getResult(id, sectionId);
    return (r?.rating as string | null) ?? null;
   });
   findings.batchSetRating(sectionId, state.currentSectionItems, state.batchSelected, levelId);
   const label = state.ratingLevels.find((l) => l.id === levelId)?.label ?? levelId;
   pushToast({
    message: m.editor_route_batch_rated({ count: selectedIds.length, s: selectedIds.length === 1 ? '' : 's', label }),
    actionLabel: m.common_undo(),
    durationMs: 6000,
    onAction: () => {
     for (const { itemId, prior: p } of prior) {
      findings.setRating(sectionId, itemId, p);
     }
    },
   });
  }}
  onExit={() => { state.setBatchMode(false); state.setBatchSelected({}); }}
 />
 )}

 {/* ------------------------------------------------------------ */}
 {/* Footer Bar */}
 {/* ------------------------------------------------------------ */}
 <FooterBar connected={presence.connected} status={presence.status} roster={presence.roster} />

 {/* ------------------------------------------------------------ */}
 {/* Inspector Tools Dock (FAB) */}
 {/* ------------------------------------------------------------ */}
 <InspectorToolsDock
 onToggleSpeedMode={toggleSpeedMode}
 onBurstCamera={(itemId) => {
 state.setBurstCameraItemId(itemId || state.activeItemId || null);
 state.setBurstCameraOpen(true);
 }}
 onPhotoStudio={() => {
 if (!state.activeItemId) return;
 const result = state.getResult(state.activeItemId);
 const photos = (result?.photos as string[]) || [];
 if (photos.length > 0) {
  openPhotoStudio({
   url: `/api/inspections/${state.inspection.id}/photo?key=${encodeURIComponent(photos[0])}`,
   key: photos[0],
   index: 1,
   total: photos.length,
  });
 } else {
  openPhotoStudio({ url: null, key: null, index: 0, total: 0 });
 }
 }}
 onToggleCheatsheet={() =>
 state.setShowCheatsheet(!state.showCheatsheet)
 }
 activeItemId={state.activeItemId || undefined}
 hidden={state.speedMode}
 />
 </div>
 );
}
