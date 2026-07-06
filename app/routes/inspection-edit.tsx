import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useLoaderData, useFetcher, useNavigate, useRevalidator } from "react-router";
import { findRatingLevel, ratingAdvanceDecision } from "~/lib/rating-levels";
import { makeCustomDefect } from "~/lib/custom-defects";
import { useInspectionState, fKey, type InspectionSchema } from "~/hooks/useInspection";
import { useFindings, type AttachedRepairItem } from "~/hooks/useFindings";
import { usePhotoOps } from "~/hooks/usePhotoOps";
import { useInspectionPrefs } from "~/hooks/useInspectionPrefs";
import { pushToast } from "~/hooks/useToast";
import { useKeyboard } from "~/hooks/useKeyboard";
import { useCannedComments } from "~/hooks/useCannedComments";
import { useUnsavedChanges } from "~/hooks/useUnsavedChanges";
import { usePresence } from "~/hooks/usePresence";
import { useTheme } from "~/hooks/useTheme";
import { useResultsDoc } from "~/lib/collab/use-results-doc";
import { useMediaDrain } from "~/hooks/useMediaDrain";
import { bindResultMap, appendPendingPhoto } from "~/lib/collab/results-binding";
import { enqueueMedia } from "~/lib/collab/media-upload-queue";
import { VersionHistoryPanel } from "~/components/collab/VersionHistoryPanel";
import type { ResultsProjection } from "../../server/lib/collab/results-doc.types";
import { SectionRail } from "~/components/editor/SectionRail";
import { EditorHeader } from "~/components/editor/EditorHeader";
import { ItemList } from "~/components/editor/ItemList";
import { ItemEditor } from "~/components/editor/ItemEditor";
import { TagChipRow, type TagPin } from "~/components/editor/TagChipRow";
import type { DefectFieldsValue } from "~/components/editor/DefectFieldsRow";
import { SideRail } from "~/components/editor/SideRail";
import { SpeedMode } from "~/components/editor/SpeedMode";
import { FooterBar } from "~/components/editor/FooterBar";
import { BatchActionBar } from "~/components/editor/BatchActionBar";
import { capturePriorRatings } from "~/lib/editor/batch-undo";
import { KeyboardHud } from "~/components/editor/KeyboardHud";
import { InspectorToolsDock } from "~/components/editor/InspectorToolsDock";
import { BurstCamera } from "~/components/editor/BurstCamera";
import { PhotoAnnotator } from "~/components/media-studio/PhotoAnnotator";
import { PropertyInfoForm } from "~/components/editor/PropertyInfoForm";
import { PcaNarrativePanel } from "~/components/inspection/PcaNarrativePanel";
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
import { ToastPortal } from "~/components/Toast";
import { useIsMobile } from "~/hooks/useBreakpoint";
import { MobileAppBar } from "~/components/editor/MobileAppBar";
import { MobileDrawerTriggers, type MobileDrawerId } from "~/components/editor/MobileDrawerTriggers";
import { MobileBottomDrawer } from "~/components/MobileBottomDrawer";
import type { PublishReadiness, PublishBlockingDefect } from "~/lib/types";

export function meta() {
 return [{ title: "Edit Inspection - OpenInspection" }];
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
 const navigate = useNavigate();
 const photoInputRef = useRef<HTMLInputElement>(null);
 const { scheme, setColorScheme } = useTheme();

 /* Plan 7 — add-media chooser (photo OR video) + video capture overlay. The
  * add tile opens the chooser; "Photo" triggers the existing photo input,
  * "Video" opens VideoCapture. Video upload requires a connection (it does NOT
  * use the offline photo queue — clip sizes make IndexedDB replay impractical). */
 const [addMediaChooser, setAddMediaChooser] = useState<{ itemId: string } | null>(null);
 const [videoCaptureTarget, setVideoCaptureTarget] = useState<{ itemId: string } | null>(null);

 /* ---------------------------------------------------------------- */
 /* Core state (useInspection) */
 /* ---------------------------------------------------------------- */

 const state = useInspectionState({
 inspection: loaderData.inspection,
 schema: loaderData.schema as unknown as InspectionSchema,
 results: loaderData.results,
 ratingLevels: loaderData.ratingLevels,
 });

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
 bucketForRatingId: state.bucketForRatingId,
 });

 /* ---------------------------------------------------------------- */
 /* Server-fetched comments for the library drawer + SideRail tab   */
 /* ---------------------------------------------------------------- */

 const [serverComments, setServerComments] = useState<Array<{
 id: string; text: string; useCount?: number; lastUsedAt?: number | null;
 }>>([]);

 // Tracks whether the SideRail library tab is open; combined with
 // showCommentLibrary to decide when to fetch server comments.
 const [librarySideOpen, setLibrarySideOpen] = useState(false);

 useEffect(() => {
 if (!state.showCommentLibrary && !librarySideOpen) { setServerComments([]); return; }
 const ctx: { itemLabel?: string; section?: string; ratingBucket?: string; search?: string } = {};
 if (comments.filterMode === 'auto' && state.activeItem) {
 ctx.itemLabel = (state.activeItem.label || state.activeItem.name || '') as string;
 ctx.section   = state.currentSection?.title;
 const r = state.activeItemId ? state.getResult(state.activeItemId)?.rating : null;
 if (r && state.bucketForRatingId) {
 ctx.ratingBucket = state.bucketForRatingId(r as string);
 }
 }
 // Track H (IA-5) — the modal's search box queries the SERVER (SQL pushdown
 // over the whole tenant library incl. imported rows); it used to only reset
 // the keyboard cursor. Bucket chips override the context-derived rating.
 const q = state.commentLibrarySearch.trim();
 if (q.length >= 2) ctx.search = q;
 if (['satisfactory', 'monitor', 'defect'].includes(state.commentLibraryFilter)) {
 ctx.ratingBucket = state.commentLibraryFilter;
 }
 let cancelled = false;
 const t = setTimeout(() => {
 comments.fetchFiltered(ctx).then((rows) => {
 if (cancelled) return;
 setServerComments(rows as Array<{ id: string; text: string; useCount?: number; lastUsedAt?: number | null }>);
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
 state.bucketForRatingId,
 ]);

 const revalidator = useRevalidator();

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
 message: "Save failed — your last change did NOT reach the server.",
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
 message: `Entered next section: ${newSectionTitle}`,
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

 const handlePhotoUpload = useCallback(
 (e: React.ChangeEvent<HTMLInputElement>) => {
 const file = e.target.files?.[0];
 if (!file || !state.activeItemId) return;
 const itemId = state.activeItemId;

 // N2+N4 — bake before submit (auto-orient + downscale + EXIF/GPS strip),
 // unless the user opted into original quality. Capture the
 // defect target ref into a local BEFORE the await so a second picker open
 // cannot clobber it. The offline branch above keeps the RAW File (Task 5
 // bakes at replay).
 const orig = originalQualityEnabled();
 const target = pendingPhotoTargetRef.current;
 pendingPhotoTargetRef.current = null;
 void (async () => {
 const baked = orig ? file : await preprocessImage(file);

 // #181 PR-G — offline: persist the baked photo locally + append a PENDING
 // doc entry (empty key + pendingUpload). The strip renders it from the
 // local blob; the drain (on reconnect / online) uploads it to R2 and swaps
 // in the real key. Defect-targeted offline adds fall back to the online
 // fetcher (the pending-doc model covers item photos; defect pending is out
 // of scope) — they simply re-fire when back online.
 const doc = collab?.doc ?? null;
 const sid = state.sectionIdForItem(itemId) ?? state.currentSection?.id;
 if (typeof navigator !== "undefined" && navigator.onLine === false && doc && sid && !target) {
  const fk = fKey(sid, itemId);
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
  return;
 }

 const formData = new FormData();
 formData.append("intent", "upload-photo");
 formData.append("itemId", itemId);
 formData.append("file", baked);
 if (target) {
  formData.append("targetType", "defect");
  formData.append("customId", target.id);
  formData.append("defectKind", target.kind);
 }
 uploadFetcher.submit(formData, { method: "post", encType: "multipart/form-data" });
 })();
 // Reset input so picking the same file twice re-fires onChange
 if (photoInputRef.current) photoInputRef.current.value = "";
 },
 [state.activeItemId, state.inspection.id, uploadFetcher, collab?.doc, state.sectionIdForItem, state.currentSection],
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
 itemId?: string;
 targetType?: "item" | "defect";
 customId?: string;
 defectKind?: "canned" | "custom";
 }
 | undefined;
 if (uploadFetcher.state !== "idle" || !d || processedUploadData.current === d) return;
 processedUploadData.current = d;
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
 pushToast({
 message: `${d.keys.length} photo${d.keys.length === 1 ? "" : "s"} added${d.targetType === "defect" ? " to defect" : ""}`,
				variant: "success",
 durationMs: 2000,
 });
 }
 if (d.ok === false) {
 pushToast({
 message: "Photo upload failed — your photo did NOT reach the server.",
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
 state.bucketForRatingId(r?.rating as string),
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
 if (!state.activeItemId) return;
 photoInputRef.current?.click();
 },
 onSave: () => findings.saveNow(),
 onPublish: () => { setPublishError(null); state.setShowPublishModal(true); },
 onCloneLast: () => handleCloneLast(inspectionPrefs.cloneDefault),
 onSaveAsSnippet: () => {
 if (!state.activeItemId) return;
 const r = state.getResult(state.activeItemId);
 const notes = ((r?.notes as string) || "").trim();
 if (!notes) return;
 const bucket = state.bucketForRatingId(r?.rating as string);
 const section = state.currentSection?.title || "";
 comments.saveSnippet(notes, bucket, section, undefined, (state.activeItem?.label || state.activeItem?.name || undefined) as string | undefined);
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
 sections={state.sections}
 activeSection={state.currentSection?.id || ""}
 onSelect={(id) => {
 state.selectSectionById(id);
 state.setActiveView("items");
 if (isMobile) setMobileDrawer(null);
 }}
 results={state.results}
 sectionProgress={state.sectionProgress}
 sectionDefectCount={state.sectionDefectCount}
 overviewActive={state.activeView === "property"}
 onSelectOverview={() => state.setActiveView("property")}
 onAddSection={structure.addSection}
 onDuplicateSection={structure.duplicateSection}
 onDeleteSection={structure.deleteSection}
 onMoveSection={structure.moveSection}
 onSaveToTemplate={structure.openSaveTemplate}
 canSaveBack={structure.canSaveBack}
 />
 );

 const itemListEl = (
 <ItemList
 items={visibleItems}
 sectionId={state.currentSection?.id || ""}
 activeItemId={state.activeItemId}
 onSelect={(id) => {
 state.setActiveItemId(id);
 if (isMobile) setMobileDrawer(null);
 }}
 results={state.results}
 batchMode={state.batchMode}
 batchSelected={state.batchSelected}
 onBatchToggle={(id) => state.toggleBatchSelect(id)}
 onBatchRange={(from, to) => state.batchSelectRange(from, to)}
 onAddItem={() => structure.openAddItemPrompt(state.currentSection?.id || "")}
 onDuplicateItem={(itemId) => structure.duplicateItem(state.currentSection?.id || "", itemId)}
 onDeleteItem={(itemId) => structure.deleteItem(state.currentSection?.id || "", itemId)}
 onMoveItem={(itemId, dir) => structure.moveItem(state.currentSection?.id || "", itemId, dir)}
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
   : photoInputRef.current?.click()
 }
 onAddDefectPhoto={(target) => {
 pendingPhotoTargetRef.current = target;
 photoInputRef.current?.click();
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
 "defect",
 state.currentSection?.title || "",
 undefined,
 (state.activeItem?.label || state.activeItem?.name || undefined) as string | undefined,
 ).then((ok) => {
 if (!ok) pushToast({ message: "Saved the defect, but the library copy failed — try again from Notes › Save as snippet.", variant: "warning", durationMs: 6000 });
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
 Select an item from the list to start editing
 </p>
 <p className="text-[11px] mt-2 text-ih-fg-4">
 Press <kbd className="px-1.5 py-0.5 bg-ih-bg-muted rounded text-[10px] font-mono border">J</kbd> / <kbd className="px-1.5 py-0.5 bg-ih-bg-muted rounded text-[10px] font-mono border">K</kbd> to navigate
 </p>
 </div>
 </div>
 );

 const sideRailEl = (
 <SideRail
 activeItem={state.activeItem ? { id: state.activeItem.id, label: (state.activeItem.label || state.activeItem.name || "") as string } : null}
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
 />
 );

 /* B-22: empty-template CTA — shown instead of normal editor body when the
  * inspection has no sections (template not applied yet). Opens the
  * InspectionSettingsSheet where the user can pick a template. */
 const emptyTemplateEl = state.sections.length === 0 ? (
 <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-6">
  <p className="text-[15px] font-semibold text-ih-fg-1">This inspection has no template content</p>
  <p className="text-[13px] text-ih-fg-3 max-w-sm">Apply a template to get sections, items and canned comments — or import your Spectora template.</p>
  <button
  onClick={() => state.setSettingsOpen(true)}
  className="px-4 h-10 rounded-lg bg-ih-primary text-white text-[13px] font-bold hover:bg-ih-primary-600"
  >
  Choose a template
  </button>
 </div>
 ) : null;

 /* ---------------------------------------------------------------- */
 /* Render */
 /* ---------------------------------------------------------------- */

 if (isMobile) {
 return (
 <div className="min-h-screen pb-14">
 <ToastPortal />
 {/* FE-2: the hidden photo input previously rendered only in the desktop
 tree — on mobile photoInputRef.current was null and every photo
 entry point was dead. */}
 <input
 ref={photoInputRef}
 type="file"
 accept="image/*"
 capture="environment"
 className="hidden"
 onChange={handlePhotoUpload}
 />
 <MobileAppBar
 sectionTitle={state.currentSection?.title ?? ''}
 itemLabel={((state.activeItem?.label || state.activeItem?.name) as string | undefined) ?? 'Select an item'}
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
  <p className="text-center text-ih-fg-3 mt-12">Tap [☰ Sections] below to begin</p>
 ))}
 </main>
 <MobileDrawerTriggers onOpen={(id) => setMobileDrawer(id)} />
 <MobileBottomDrawer
 open={mobileDrawer === 'sections'}
 onClose={() => setMobileDrawer(null)}
 title="Sections"
 >
 {sectionRailEl}
 </MobileBottomDrawer>
 <MobileBottomDrawer
 open={mobileDrawer === 'items'}
 onClose={() => setMobileDrawer(null)}
 title="Items"
 >
 {itemListEl}
 </MobileBottomDrawer>
 <MobileBottomDrawer
 open={mobileDrawer === 'preview'}
 onClose={() => setMobileDrawer(null)}
 title="Preview"
 >
 {sideRailEl}
 </MobileBottomDrawer>
 </div>
 );
 }

 return (
 <div className="flex h-screen bg-ih-bg-card">
 <ToastPortal />
 {/* Hidden photo input */}
 <input
 ref={photoInputRef}
 type="file"
 accept="image/*"
 capture="environment"
 className="hidden"
 onChange={handlePhotoUpload}
 />

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
 {state.showCheatsheet && <KeyboardHud />}

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

 {/* Plan 7 — add-media chooser: photo OR video. Video requires a connection
  * (no offline queue); the Video option disables + hints when offline. */}
 {addMediaChooser && (
 <AddMediaChooser
  onClose={() => setAddMediaChooser(null)}
  onPickPhoto={() => {
   setAddMediaChooser(null);
   photoInputRef.current?.click();
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

 {/* Plan 4 (Task 8) — per-photo crop overlay. Cropping ALWAYS re-derives from
  * the ORIGINAL key. A re-crop that would discard an existing annotation warns
  * first (no native window.confirm). */}
 {photoCropTarget && (
 <PhotoCropper
  sourceUrl={fullResUrl(photoCropTarget.sourceUrl)}
  allowFree
  title="Crop photo"
  saveLabel="Save crop"
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
 scheme={scheme}
 setColorScheme={setColorScheme}
 tenantSlug={loaderData.tenantSlug}
 setSignModalOpen={setSignModalOpen}
 handlePublishClick={handlePublishClick}
 collabEditing={loaderData.collabEditing}
 onOpenVersionHistory={() => setVersionHistoryOpen(true)}
 />
 {/* ------------------------------------------------------------ */}
 {/* 4-column layout below header */}
 {/* ------------------------------------------------------------ */}
 <div className="flex flex-1 pt-14 pb-9">
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
 {(["all", "unrated", "issues", "flagged"] as const).map((f) => (
 <button
 key={f}
 onClick={() => state.setItemFilter(f)}
 className={`px-2 py-0.5 rounded text-[11px] font-bold capitalize ${
 state.itemFilter === f
 ? "bg-ih-primary-tint text-ih-primary"
 : "text-ih-fg-3 hover:text-ih-fg-2"
 }`}
 >
 {f === "all" ? "All" : f === "unrated" ? "Unrated" : f === "issues" ? "Issues" : "Flagged"}
 {f !== "all" && (
 <span className="ml-1 text-[10px]">
 {f === "unrated" ? state.filterCounts.unrated : f === "issues" ? state.filterCounts.issues : state.filterCounts.flagged}
 </span>
 )}
 </button>
 ))}
 </div>
 {itemListEl}
 </div>
 )}

 {/* Column 3: Item Editor (flex-1, focal) or Inspection Details overview — always rendered */}
 <main className="flex-1 overflow-y-auto border-t-2 border-ih-primary p-6">
 {state.activeView === "property" ? (
  <>
  <PropertyInfoForm
  inspection={state.inspection}
  onSave={(fieldId, value) => {
  state.setInspection((prev) => ({
   ...prev,
   [fieldId]: value,
  }));
  }}
  />
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
  </>
 ) : itemEditorEl}
 </main>

 {/* Column 4: SideRail — hidden in fullscreen; collapsible otherwise */}
 {!state.itemFullscreen && (
  state.sideRailCollapsed ? (
  <div className="w-8 flex-shrink-0 border-l border-ih-border flex flex-col items-center pt-3">
   <button
   type="button"
   onClick={() => state.setSideRailCollapsed(false)}
   className="w-7 h-7 rounded-md flex items-center justify-center text-ih-fg-3 hover:bg-ih-bg-muted"
   title="Expand photo rail"
   >
   <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
   </svg>
   </button>
  </div>
  ) : (
  <div className="relative flex-shrink-0">
   <button
   type="button"
   onClick={() => state.setSideRailCollapsed(true)}
   className="absolute top-3 left-1 z-10 w-6 h-6 rounded-md flex items-center justify-center text-ih-fg-4 hover:bg-ih-bg-muted hover:text-ih-fg-2"
   title="Collapse photo rail"
   >
   <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
   </svg>
   </button>
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
    message: `Rated ${selectedIds.length} item${selectedIds.length === 1 ? '' : 's'} as ${label}`,
    actionLabel: 'Undo',
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
