import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useLoaderData, useFetcher, useNavigate, useRevalidator } from "react-router";
import { findRatingLevel, ratingAdvanceDecision } from "~/lib/rating-levels";
import { makeCustomDefect } from "~/lib/custom-defects";
import { useInspectionState, type InspectionSchema } from "~/hooks/useInspection";
import { useFindings, type AttachedRepairItem } from "~/hooks/useFindings";
import { usePhotoOps } from "~/hooks/usePhotoOps";
import { useInspectionPrefs } from "~/hooks/useInspectionPrefs";
import { pushToast } from "~/hooks/useToast";
import { useKeyboard } from "~/hooks/useKeyboard";
import { useCannedComments } from "~/hooks/useCannedComments";
import { useOfflineQueue, getOfflineQueue } from "~/hooks/useOfflineQueue";
import { shouldQueue } from "~/lib/offline/should-queue";
import { formatReplayToasts } from "~/lib/offline/replay-toasts";
import { NetworkPill } from "~/components/sync/NetworkPill";
import {
 addQueuedPreview,
 clearQueuedPreviews,
 collectObjectUrls,
 type QueuedPreviewMap,
} from "~/lib/offline/queued-photo-previews";
import { useUnsavedChanges } from "~/hooks/useUnsavedChanges";
import { usePresence } from "~/hooks/usePresence";
import { useTheme } from "~/hooks/useTheme";
import { SectionRail } from "~/components/editor/SectionRail";
import { EditorHeader } from "~/components/editor/EditorHeader";
import { ItemList } from "~/components/editor/ItemList";
import { ItemEditor } from "~/components/editor/ItemEditor";
import { TagChipRow, type TagPin } from "~/components/editor/TagChipRow";
import type { DefectFieldsValue } from "~/components/editor/DefectFieldsRow";
import { SideRail } from "~/components/editor/SideRail";
import { SpeedMode } from "~/components/editor/SpeedMode";
import { FooterBar } from "~/components/editor/FooterBar";
import { KeyboardHud } from "~/components/editor/KeyboardHud";
import { InspectorToolsDock } from "~/components/editor/InspectorToolsDock";
import { BurstCamera } from "~/components/editor/BurstCamera";
import { PhotoAnnotator } from "~/components/media-studio/PhotoAnnotator";
import { PropertyInfoForm } from "~/components/editor/PropertyInfoForm";
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
 /* Findings (CRUD) */
 /* ---------------------------------------------------------------- */

 const findings = useFindings(state.results, state.setResults, fetcher, {
 sectionIdForItem: state.sectionIdForItem,
 setDirty: state.setDirty,
 setSaveStatus: state.setSaveStatus,
 inspectionId: String(state.inspection.id),
 notesFetcher,
    // Offline-first: route field writes into the queue when shouldQueue() says so.
    offlineQueue: getOfflineQueue(),
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
 /* Server-fetched comments for the library drawer (sort/filter aware) */
 /* ---------------------------------------------------------------- */

 const [serverComments, setServerComments] = useState<Array<{
 id: string; text: string; useCount?: number; lastUsedAt?: number | null;
 }>>([]);

 useEffect(() => {
 if (!state.showCommentLibrary) { setServerComments([]); return; }
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

 /* ---------------------------------------------------------------- */
 /* Offline queue */
 /* ---------------------------------------------------------------- */

 const offline = useOfflineQueue();
 const revalidator = useRevalidator();

 /* ---------------------------------------------------------------- */
 /* Queued photo previews (Task 4) */
 /* ---------------------------------------------------------------- */

 // itemId → Array<{ name, objectUrl }> — local blob previews for photos
 // queued while offline.  Object URLs are created on enqueue and revoked
 // on unmount or after a successful replay clears the queue.
 const [queuedPhotoPreviews, setQueuedPhotoPreviews] = useState<QueuedPreviewMap>({});
 const queuedPhotoPreviewsRef = useRef(queuedPhotoPreviews);
 queuedPhotoPreviewsRef.current = queuedPhotoPreviews;

 // Revoke all object URLs when the route unmounts.
 useEffect(() => {
  return () => {
   for (const url of collectObjectUrls(queuedPhotoPreviewsRef.current)) {
    URL.revokeObjectURL(url);
   }
  };
 }, []);

 // When a replay finishes (syncing flips false → true → false) AND pending
 // count reaches 0, clear the preview map and revalidate loader data so the
 // confirmed server photos appear in the strip.
 const prevSyncing = useRef(false);
 useEffect(() => {
  const justFinished = prevSyncing.current && !offline.syncing;
  prevSyncing.current = offline.syncing;
  if (justFinished && offline.pendingCount === 0) {
   // Revoke object URLs before clearing so the browser can GC the blobs.
   for (const url of collectObjectUrls(queuedPhotoPreviewsRef.current)) {
    URL.revokeObjectURL(url);
   }
   setQueuedPhotoPreviews(clearQueuedPreviews());
   revalidator.revalidate();
  }
 }, [offline.syncing, offline.pendingCount, revalidator]);

 /* ---------------------------------------------------------------- */
 /* Manual sync — fires toasts from the ReplayResult */
 /* ---------------------------------------------------------------- */

 const handleSyncNow = useCallback(async () => {
  const result = await offline.replayNow();
  if (!result) return; // single-flight guard fired — a replay was already running
  for (const t of formatReplayToasts(result)) {
   pushToast({ message: t.message, durationMs: t.durationMs });
  }
 }, [offline]);

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
 // DB-16 — dedicated fetcher for set/clear report cover (avoids the
 // shared-fetcher abort hazard; the loader revalidates the cover after).
 const coverFetcher = useFetcher();

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
  itemGalleryPhotos,
  onOpenPhoto,
  onReorderPhotos,
  onBulkDetachPhotos,
  moveTargets,
  onBulkMovePhotos,
  onViewerAction,
  performPhotoCropSave,
 } = usePhotoOps({
  state,
  findings,
  streamCustomerSubdomain,
  revalidator,
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

 // Task 4 — when offline, enqueue for later replay and show a local preview.
 const nav = typeof navigator !== "undefined" ? navigator : undefined;
 if (shouldQueue(nav)) {
  const objectUrl = URL.createObjectURL(file);
  setQueuedPhotoPreviews((prev) =>
   addQueuedPreview(prev, itemId, { name: file.name, objectUrl }),
  );
  void getOfflineQueue().enqueuePhoto({
   inspectionId: String(state.inspection.id),
   itemId,
   name: file.name,
   blob: file,
   enqueuedAt: Date.now(),
   // N4 — capture the opt-out at enqueue time; the RAW file is stored and baked
   // at replay (so a failed-then-retried entry never double-bakes).
   originalQuality: originalQualityEnabled(),
  });
  pushToast({ message: "Photo queued — will upload when back online", durationMs: 3000 });
  // Reset input so picking the same file twice re-fires onChange
  if (photoInputRef.current) photoInputRef.current.value = "";
  return;
 }

 // N2+N4 — bake on the ONLINE path before submit (auto-orient + downscale +
 // EXIF/GPS strip), unless the user opted into original quality. Capture the
 // defect target ref into a local BEFORE the await so a second picker open
 // cannot clobber it. The offline branch above keeps the RAW File (Task 5
 // bakes at replay).
 const orig = originalQualityEnabled();
 const target = pendingPhotoTargetRef.current;
 pendingPhotoTargetRef.current = null;
 void (async () => {
 const baked = orig ? file : await preprocessImage(file);
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
 [state.activeItemId, state.inspection.id, uploadFetcher],
 );

 const handleBurstCommit = useCallback(
 (blobs: Blob[]) => {
 if (!state.burstCameraItemId || blobs.length === 0) return;
 const itemId = state.burstCameraItemId;

 // Task 6 (rider) — same offline branch as handlePhotoUpload: when offline,
 // enqueue each captured blob and show a local preview instead of uploading.
 const nav = typeof navigator !== "undefined" ? navigator : undefined;
 if (shouldQueue(nav)) {
  blobs.forEach((blob, i) => {
  const name = `burst-${i + 1}.jpg`;
  const objectUrl = URL.createObjectURL(blob);
  setQueuedPhotoPreviews((prev) =>
   addQueuedPreview(prev, itemId, { name, objectUrl }),
  );
  void getOfflineQueue().enqueuePhoto({
   inspectionId: String(state.inspection.id),
   itemId,
   name,
   blob,
   enqueuedAt: Date.now(),
   originalQuality: originalQualityEnabled(),
  });
  });
  pushToast({
  message: `${blobs.length} photo${blobs.length === 1 ? "" : "s"} queued — will upload when back online`,
  durationMs: 3000,
  });
  return;
 }

 // N4 — bake each frame on the ONLINE path. Burst frames are already
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
 onSetViewMode: (mode: "split" | "focus" | "preview") => {
 if (mode === "preview") {
 window.open(`/inspections/${state.inspection.id}/preview`, "_blank");
 return;
 }
 state.setViewMode(mode);
 },
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
 if (isMobile) setMobileDrawer(null);
 }}
 results={state.results}
 sectionProgress={state.sectionProgress}
 sectionDefectCount={state.sectionDefectCount}
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
 if (!ok) pushToast({ message: "Saved the defect, but the library copy failed — try again from Notes › Save as snippet.", variant: "error", durationMs: 6000 });
 });
 }}
 queuedPreviews={state.activeItemId ? (queuedPhotoPreviews[state.activeItemId] ?? []) : []}
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
 onGalleryAnnotate={(p) => {
  setPhotoStudioUrl(p.url);
  setPhotoStudioKey(p.key);
  setPhotoStudioIndex(0);
  setPhotoStudioTotal(0);
  setPhotoStudioOpen(true);
 }}
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

 // Offline status surfaces — shared by BOTH layout branches (a phone in the
 // field is exactly where the offline indicator matters most).
 const offlineStatusEl = (
  <>
   {!offline.online && (
    <div className="fixed top-14 left-0 right-0 z-40 bg-ih-watch-bg border-b border-ih-watch px-4 py-2 text-center">
     <span className="text-[12px] font-bold text-ih-watch-fg">
      Saved on this device — will sync when you&apos;re back online.
     </span>
    </div>
   )}
   <NetworkPill
    online={offline.online}
    pendingCount={offline.pendingCount}
    failedCount={offline.failedCount}
    syncing={offline.syncing}
    onSyncNow={handleSyncNow}
   />
  </>
 );

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
  // B-22: back from item editor → item list; back from list → dashboard
  if (state.activeItemId) { state.setActiveItemId(null); return; }
  navigate('/dashboard');
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
   {offlineStatusEl}
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
 onPrev={() => {
 if (state.speedCurrent > 0)
 state.setSpeedCurrent(state.speedCurrent - 1);
 }}
 onNext={() => {
 if (state.speedCurrent < state.speedQueue.length - 1)
 state.setSpeedCurrent(state.speedCurrent + 1);
 }}
 onExit={() => state.setSpeedMode(false)}
 currentIndex={state.speedCurrent}
 totalCount={state.speedQueue.length}
 onNextItem={() => {
 if (state.speedCurrent < state.speedQueue.length - 1)
 state.setSpeedCurrent(state.speedCurrent + 1);
 }}
 onPrevItem={() => {
 if (state.speedCurrent > 0)
 state.setSpeedCurrent(state.speedCurrent - 1);
 }}
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
   // Task 9c — offline-capable annotate. When offline, enqueue the baked PNG
   // through the SAME media queue photo uploads use; the annotation derivative
   // replays to the annotation endpoint on reconnect. When online, submit
   // directly (unchanged).
   const nav = typeof navigator !== "undefined" ? navigator : undefined;
   if (shouldQueue(nav)) {
    void getOfflineQueue().enqueuePhoto({
     inspectionId: String(state.inspection.id),
     itemId,
     name: "annotated.png",
     blob: new File([blob], "annotated.png", { type: "image/png" }),
     enqueuedAt: Date.now(),
     derivative: {
      kind: "annotation",
      photoIndex: photoStudioIndex,
      nodes: nodesJson,
      ...(sectionId ? { sectionId } : {}),
     },
    });
    pushToast({ message: "Annotation queued — will save when back online", durationMs: 3000 });
   } else {
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
 {recropWarn && (
 <RecropWarningModal
 onCancel={() => setRecropWarn(null)}
 onConfirm={() => { const r = recropWarn.run; setRecropWarn(null); r(); }}
 />
 )}

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
 {blocker.state === "blocked" && (
 <UnsavedChangesBlocker
 onStay={cancelLeave}
 onLeave={confirmLeave}
 />
 )}

 {/* Publish confirmation modal */}
 {state.showPublishModal && (
 <PublishModal
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
 />
 )}

 {/* Inspector sign modal */}
 {signModalOpen && (
 <SignModal
 onSubmit={handleSignSubmit}
 onCancel={() => setSignModalOpen(false)}
 failed={Boolean(signFetcher.data && !(signFetcher.data as { ok: boolean }).ok)}
 />
 )}

 {/* Comment library drawer */}
 {state.showCommentLibrary && (
 <CommentLibraryDrawer
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
 onInsert={(sectionId, itemId, text) => findings.insertComment(sectionId, itemId, text)}
 onClose={() => state.setShowCommentLibrary(false)}
 />
 )}

 {/* Section picker modal */}
 {state.sectionPickerOpen && (
 <SectionPickerModal
 sectionPickerQuery={state.sectionPickerQuery}
 setSectionPickerQuery={state.setSectionPickerQuery}
 filteredSectionsForPicker={state.filteredSectionsForPicker}
 sections={state.sections}
 pickSection={state.pickSection}
 closeSectionPicker={state.closeSectionPicker}
 />
 )}

 {/* Tag picker modal */}
 {tagPickerOpen && state.activeItemId && (
 <TagPickerModal
  activeItemId={state.activeItemId}
  tagsByItem={state.tagsByItem}
  presetTags={PRESET_TAGS}
  onToggle={toggleTag}
  onClose={() => setTagPickerOpen(false)}
 />
 )}

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
 autoSign={autoSign}
 handleAutoSignToggle={handleAutoSignToggle}
 tenantSlug={loaderData.tenantSlug}
 setSignModalOpen={setSignModalOpen}
 handlePublishClick={handlePublishClick}
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
 {/* Column 1: Section Rail (200px) */}
 {sectionRailEl}

 {/* Column 2: Item List (280px) OR Property Info */}
 <div className="w-[280px] flex-shrink-0 border-r border-ih-border flex flex-col overflow-hidden relative">
 {/* View toggle (Items / Property) */}
 <div className="flex items-center border-b border-ih-border">
 <button
 onClick={() => state.setActiveView("items")}
 className={`flex-1 py-2 text-[11px] font-bold text-center ${state.activeView === "items" ? "text-ih-primary border-b-2 border-ih-primary" : "text-ih-fg-3"}`}
 >Items</button>
 <button
 onClick={() => state.setActiveView("property")}
 className={`flex-1 py-2 text-[11px] font-bold text-center ${state.activeView === "property" ? "text-ih-primary border-b-2 border-ih-primary" : "text-ih-fg-3"}`}
 >Property</button>
 </div>
 {state.activeView === "property" ? (
 <div className="flex-1 overflow-y-auto">
 <PropertyInfoForm
 inspection={state.inspection}
 onSave={(fieldId, value) => {
 state.setInspection((prev) => ({
 ...prev,
 [fieldId]: value,
 }));
 }}
 />
 </div>
 ) : (
 <>
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
 {state.batchMode && (
 <div className="flex items-center gap-1 px-3 py-1 border-b border-ih-border">
  <button
  onClick={() => state.batchSelectAll()}
  className="px-2 py-0.5 rounded text-[11px] font-bold text-ih-primary hover:bg-ih-primary-tint"
  >
  Select All
  </button>
  <button
  onClick={() => state.setBatchSelected({})}
  className="px-2 py-0.5 rounded text-[11px] font-bold text-ih-fg-3 hover:text-ih-fg-2"
  >
  Clear
  </button>
 </div>
 )}
 {itemListEl}
 {state.batchMode && state.selectedBatchCount > 0 && (
 <div className="absolute bottom-0 left-0 right-0 bg-ih-bg-card border-t border-ih-border p-2 flex items-center gap-2">
  <span className="text-[11px] font-bold text-ih-fg-2">{state.selectedBatchCount} selected</span>
  <div className="flex gap-1 ml-auto">
  {state.ratingLevels.slice(0, 5).map((level, idx) => (
   <button
   key={level.id}
   onClick={() => findings.batchSetRating(state.currentSection?.id || "", state.currentSectionItems, state.batchSelected, level.id)}
   className="w-7 h-7 rounded text-[10px] font-bold"
   style={{ background: state.getRatingColor(level.id), color: "white" }}
   >
   {idx + 1}
   </button>
  ))}
  </div>
  <button
  onClick={() => { state.setBatchMode(false); state.setBatchSelected({}); }}
  className="text-[11px] text-ih-fg-3 hover:text-ih-fg-1"
  >
  Cancel
  </button>
 </div>
 )}
 </>
 )}
 </div>

 {/* Column 3: Item Editor (flex-1, focal) */}
 <main className="flex-1 overflow-y-auto border-t-2 border-ih-primary p-6">
 {itemEditorEl}
 </main>

 {/* Column 4: SideRail */}
 {sideRailEl}
 </>
 )}
 </div>

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
  setPhotoStudioUrl(`/api/inspections/${state.inspection.id}/photo?key=${encodeURIComponent(photos[0])}`);
  setPhotoStudioKey(photos[0]);
  setPhotoStudioIndex(1);
  setPhotoStudioTotal(photos.length);
 } else {
  setPhotoStudioUrl(null);
  setPhotoStudioKey(null);
  setPhotoStudioIndex(0);
  setPhotoStudioTotal(0);
 }
 setPhotoStudioOpen(true);
 }}
 onToggleCheatsheet={() =>
 state.setShowCheatsheet(!state.showCheatsheet)
 }
 activeItemId={state.activeItemId || undefined}
 hidden={state.speedMode}
 />

 {offlineStatusEl}
 </div>
 );
}
