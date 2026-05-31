import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useLoaderData, useFetcher, useNavigate } from "react-router";
import type { Route } from "./+types/inspection-edit";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { useInspectionState } from "~/hooks/useInspection";
import type { RatingLevel, ResultMap } from "~/hooks/useInspection";
import { useFindings } from "~/hooks/useFindings";
import { useInspectionPrefs } from "~/hooks/useInspectionPrefs";
import { pushToast } from "~/hooks/useToast";
import { useKeyboard } from "~/hooks/useKeyboard";
import { useCannedComments } from "~/hooks/useCannedComments";
import { useOfflineQueue } from "~/hooks/useOfflineQueue";
import { useUnsavedChanges } from "~/hooks/useUnsavedChanges";
import { usePresence } from "~/hooks/usePresence";
import { useTheme } from "~/hooks/useTheme";
import { SectionRail } from "~/components/editor/SectionRail";
import { ProgressStripText } from "~/components/editor/ProgressStripText";
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
import { PhotoStudio } from "~/components/editor/PhotoStudio";
import { PropertyInfoForm } from "~/components/editor/PropertyInfoForm";
import { InspectionSettingsSheet } from "~/components/editor/InspectionSettingsSheet";
import { SignaturePad } from "~/components/SignaturePad";
import { PublishGateModal } from "~/components/editor/PublishGateModal";
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
/* Loader */
/* ------------------------------------------------------------------ */

export async function loader({ request, params, context }: Route.LoaderArgs) {
 const token = await requireToken(context, request);
 const id = params.id;

 const api = createApi(context, { token });
 const [inspRes, resultsRes, reportRes] = await Promise.all([
 api.inspections[":id"].$get({ param: { id } }),
 api.inspections[":id"].results.$get({ param: { id } }),
 api.inspections[":id"]["report-data"].$get({ param: { id } }),
 ]);

 const inspBody = inspRes.ok ? await inspRes.json() : {};
 const resultsBody = resultsRes.ok ? await resultsRes.json() : {};
 const reportBody = reportRes.ok ? await reportRes.json() : {};

 const data = ((inspBody as Record<string, unknown>).data ?? {}) as Record<string, unknown> | undefined;
 const inspection = (data?.inspection as Record<string, unknown>) || {
 id,
 propertyAddress: "Loading...",
 status: "draft",
 };
 const schema = ((data?.templateSnapshot ||
 (data?.template as Record<string, unknown>)?.schema) as {
 sections: Array<Record<string, unknown>>;
 }) || { sections: [] };

 // Normalize sections from report-data (which has rating levels + section data)
 const rdData = ((reportBody as Record<string, unknown>).data ?? {}) as Record<string, unknown> | undefined;
 const reportSections = (rdData?.sections || []) as Array<Record<string, unknown>>;
 if (reportSections.length > 0) {
 schema.sections = reportSections.map((sec: Record<string, unknown>) => {
 const s = { ...sec };
 if (!s.title && s.name) s.title = s.name;
 if (Array.isArray(s.items)) {
 s.items = (s.items as Array<Record<string, unknown>>).map((item) => {
 const it = { ...item };
 if (!it.label && it.name) it.label = it.name;
 return it;
 });
 }
 return s;
 });
 }

 const ratingLevels = ((rdData?.ratingLevels || []) as RatingLevel[]);
 const resultsObj = ((resultsBody as Record<string, unknown>).data ?? {}) as Record<string, unknown>;
 const results = ((resultsObj as Record<string, Record<string, unknown>>)?.data ||
 resultsObj ||
 {}) as ResultMap;

 return { inspection, schema, results, ratingLevels, token };
}

/* ------------------------------------------------------------------ */
/* Action (BFF relay for client mutations) */
/* ------------------------------------------------------------------ */

export async function action({ request, params, context }: Route.ActionArgs) {
 const token = await requireToken(context, request);
 const formData = await request.formData();
 const intent = formData.get("intent");
 const api = createApi(context, { token });

 if (intent === "rate") {
 const itemId = String(formData.get("itemId"));
 const sectionId = String(formData.get("sectionId"));
 const rating = String(formData.get("rating"));
 await api.inspections[":id"].items[":itemId"].$patch({
 param: { id: params.id, itemId },
 json: { field: "rating", value: rating, sectionId, expectedVersion: 0, force: true },
 });
 }

 if (intent === "notes") {
 const itemId = String(formData.get("itemId"));
 const sectionId = String(formData.get("sectionId"));
 const notes = String(formData.get("notes"));
 await api.inspections[":id"].items[":itemId"].$patch({
 param: { id: params.id, itemId },
 json: { field: "notes", value: notes, sectionId, expectedVersion: 0, force: true },
 });
 }

 if (intent === "toggle-canned") {
 const itemId = String(formData.get("itemId"));
 const sectionId = String(formData.get("sectionId"));
 const tabName = String(formData.get("tabName"));
 const cannedId = String(formData.get("cannedId"));
 const included = formData.get("included") === "true";
 await api.inspections[":id"].items[":itemId"].$patch({
 param: { id: params.id, itemId },
 json: {
 field: "cannedToggle",
 value: { tabName, cannedId, included },
 sectionId,
 expectedVersion: 0,
 force: true,
 },
 });
 }

 if (intent === "set-defect-fields") {
 const itemId = String(formData.get("itemId"));
 const sectionId = String(formData.get("sectionId"));
 const cannedId = String(formData.get("cannedId"));
 const patch = JSON.parse(String(formData.get("patch")));
 await api.inspections[":id"].items[":itemId"].$patch({
 param: { id: params.id, itemId },
 json: {
 field: "defectFields",
 value: { cannedId, ...patch },
 sectionId,
 expectedVersion: 0,
 force: true,
 },
 });
 }

 if (intent === "set-item-attribute") {
 const itemId = String(formData.get("itemId"));
 const attributeId = String(formData.get("attributeId"));
 const value = JSON.parse(String(formData.get("value")));
 await api.inspections[":id"].items[":itemId"].$patch({
 param: { id: params.id, itemId },
 json: {
 field: "itemAttribute",
 value: { attributeId, value },
 expectedVersion: 0,
 force: true,
 },
 });
 }

 if (intent === "save-all") {
 const data = formData.get("data");
 if (data) {
 await api.inspections[":id"].results.$patch({
 param: { id: params.id },
 json: { data: JSON.parse(String(data)) },
 });
 }
 }

 if (intent === "publish") {
 await api.inspections[":id"].publish.$post({ param: { id: params.id } });
 }

 if (intent === "toggle-auto-sign") {
 const autoSignOnPublish = formData.get("autoSignOnPublish") === "true";
 await api.inspections[":id"].$patch({
 param: { id: params.id },
 json: { autoSignOnPublish },
 });
 }

 if (intent === "sign-inspector") {
 const signatureBase64 = String(formData.get("signatureBase64") ?? "");
 if (signatureBase64) {
 await api.inspectionSync[":id"]["inspector-signature"].$post({
 param: { id: params.id },
 json: { signatureBase64, signedAt: new Date().toISOString() },
 });
 }
 }

 return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatRelativeTime(epochSec: number): string {
 const diffDays = Math.floor((Date.now() / 1000 - epochSec) / 86400);
 if (diffDays <= 0) return 'today';
 if (diffDays === 1) return '1 day ago';
 if (diffDays < 7)   return `${diffDays} days ago`;
 if (diffDays < 30)  return `${Math.floor(diffDays / 7)} wk ago`;
 return `${Math.floor(diffDays / 30)} mo ago`;
}

/* ------------------------------------------------------------------ */
/* Component */
/* ------------------------------------------------------------------ */

export default function InspectionEditPage() {
 const loaderData = useLoaderData<typeof loader>();
 const fetcher = useFetcher();
 const navigate = useNavigate();
 const photoInputRef = useRef<HTMLInputElement>(null);
 const { scheme, setColorScheme } = useTheme();

 /* ---------------------------------------------------------------- */
 /* Core state (useInspection) */
 /* ---------------------------------------------------------------- */

 const state = useInspectionState({
 inspection: loaderData.inspection,
 schema: loaderData.schema as { sections: Array<any> },
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
 });

 /* ---------------------------------------------------------------- */
 /* Inspection prefs (tenant clone scope, auto-advance delay, pinned tags) */
 /* ---------------------------------------------------------------- */

 const { prefs: inspectionPrefs } = useInspectionPrefs();

 /* ---------------------------------------------------------------- */
 /* Tag library fetch + memos */
 /* ---------------------------------------------------------------- */

 const [tagLibrary, setTagLibrary] = useState<TagPin[]>([]);
 useEffect(() => {
 (async () => {
 try {
 const res = await fetch('/api/tags', { credentials: 'include' });
 if (res.ok) {
 const body = await res.json() as { data?: Array<{ id: string; name: string; color: string }> };
 setTagLibrary(body.data ?? []);
 }
 } catch { /* noop */ }
 })();
 }, []);

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
 const ctx: { itemLabel?: string; section?: string; ratingBucket?: string } = {};
 if (comments.filterMode === 'auto' && state.activeItem) {
 ctx.itemLabel = (state.activeItem.label || state.activeItem.name || '') as string;
 ctx.section   = state.currentSection?.title;
 const r = state.activeItemId ? state.getResult(state.activeItemId)?.rating : null;
 if (r && state.bucketForRatingId) {
 ctx.ratingBucket = state.bucketForRatingId(r as string);
 }
 }
 comments.fetchFiltered(ctx).then((rows) => {
 setServerComments(rows as Array<{ id: string; text: string; useCount?: number; lastUsedAt?: number | null }>);
 });
 }, [
 state.showCommentLibrary,
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
  try {
   const res = await fetch(`/api/inspections/${state.inspection.id}/publish-readiness`, {
    credentials: 'include',
   });
   if (res.ok) {
    const readiness = await res.json() as PublishReadiness;
    if (!readiness.ready) {
     setPublishReadiness(readiness);
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
 const [photoStudioIndex, setPhotoStudioIndex] = useState(0);
 const [photoStudioTotal, setPhotoStudioTotal] = useState(0);

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
 if (fetcher.state === "submitting") {
 state.setSaveStatus("saving");
 } else if (fetcher.state === "idle" && state.saveStatus === "saving") {
 state.setSaveStatus("saved");
 state.setDirty(false);
 const timer = setTimeout(() => state.setSaveStatus("idle"), 2000);
 return () => clearTimeout(timer);
 }
 }, [fetcher.state]);

 /* ---------------------------------------------------------------- */
 /* Rating handler with auto-advance */
 /* ---------------------------------------------------------------- */

 const handleRating = useCallback(
 (rating: string) => {
 if (!state.activeItemId || !state.currentSection) return;
 findings.setRating(state.currentSection.id, state.activeItemId, rating);
 const level = state.ratingLevels?.find((l: { id: string; pausesAdvance?: boolean }) => l.id === rating);
 if (level?.pausesAdvance) {
 const ta = document.getElementById('notes-textarea') as HTMLTextAreaElement | null;
 ta?.focus({ preventScroll: true });
 return;
 }
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
 [state.activeItemId, state.currentSection, findings, state.advanceToNextUnrated, state.ratingLevels, inspectionPrefs.autoAdvanceDelayMs],
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

 const handlePhotoUpload = useCallback(
 async (e: React.ChangeEvent<HTMLInputElement>) => {
 const file = e.target.files?.[0];
 if (!file || !state.activeItemId) return;
 const formData = new FormData();
 formData.append("file", file);
 formData.append("itemId", state.activeItemId);
 try {
 const res = await fetch(
 `/api/inspections/${state.inspection.id}/upload`,
 {
 method: "POST",
 body: formData,
 credentials: "include",
 },
 );
 if (res.ok) {
 const json = (await res.json()) as {
 data: { key: string };
 };
 findings.addPhotoToItem(state.activeItemId, json.data.key);
 }
 } catch {
 /* swallow */
 }
 // Reset input
 if (photoInputRef.current) photoInputRef.current.value = "";
 },
 [state.activeItemId, state.inspection.id, findings],
 );

 const handleBurstCommit = useCallback(
 async (blobs: Blob[]) => {
 if (!state.burstCameraItemId) return;
 for (const blob of blobs) {
 const formData = new FormData();
 formData.append("file", blob, `burst-${Date.now()}.jpg`);
 formData.append("itemId", state.burstCameraItemId);
 try {
 const res = await fetch(
 `/api/inspections/${state.inspection.id}/upload`,
 {
 method: "POST",
 body: formData,
 credentials: "include",
 },
 );
 if (res.ok) {
 const json = (await res.json()) as {
 data: { key: string };
 };
 findings.addPhotoToItem(state.burstCameraItemId!, json.data.key);
 }
 } catch {
 /* swallow */
 }
 }
 },
 [state.burstCameraItemId, state.inspection.id, findings],
 );

 /* ---------------------------------------------------------------- */
 /* Keyboard shortcuts */
 /* ---------------------------------------------------------------- */

 const keyboardHandlers = useMemo(
 () => ({
 onRate: (level: number) => {
 if (state.activeItemId && state.currentSection && state.ratingLevels[level - 1]) {
 handleRating(state.ratingLevels[level - 1].id);
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
 handleRating(naLevel.id);
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
 onOpenSnippets: () => {
 if (!state.activeItemId) return;
 state.setCommentLibraryFilter("my-snippets");
 state.setCommentLibrarySearch("");
 state.setCommentLibrarySelectedIdx(0);
 state.setShowCommentLibrary(true);
 },
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
 onPublish: () => state.setShowPublishModal(true),
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
 onRating={handleRating}
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
 />
 ) : (
 <div className="flex items-center justify-center h-full text-slate-400">
 <div className="text-center">
 <p className="text-[13px]">
 Select an item from the list to start editing
 </p>
 <p className="text-[11px] mt-2 text-slate-300">
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
 />
 );

 /* ---------------------------------------------------------------- */
 /* Render */
 /* ---------------------------------------------------------------- */

 if (isMobile) {
 return (
 <div className="min-h-screen pb-14">
 <ToastPortal />
 <MobileAppBar
 sectionTitle={state.currentSection?.title ?? ''}
 itemLabel={((state.activeItem?.label || state.activeItem?.name) as string | undefined) ?? 'Select an item'}
 onBack={() => navigate('/dashboard')}
 onMore={() => { /* future: open more menu */ }}
 />
 <main className="p-4">
 {state.activeItemId ? (
 itemEditorEl
 ) : (
 <p className="text-center text-ih-fg-3 mt-12">Tap [☰ Sections] below to begin</p>
 )}
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
 <PhotoStudio
 open={photoStudioOpen}
 photoUrl={photoStudioUrl}
 photoIndex={photoStudioIndex}
 totalPhotos={photoStudioTotal}
 sectionName={state.currentSection?.title || state.currentSection?.name || ""}
 onSave={() => {
  setPhotoStudioOpen(false);
 }}
 onClose={() => setPhotoStudioOpen(false)}
 />

 {/* Inspection settings sheet */}
 <InspectionSettingsSheet
 open={state.settingsOpen}
 onClose={() => state.setSettingsOpen(false)}
 inspectionId={String(state.inspection.id)}
 />

 {/* Unsaved changes blocker dialog */}
 {blocker.state === "blocked" && (
 <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
 <div
 className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
 onClick={cancelLeave}
 />
 <div className="relative bg-ih-bg-card rounded-lg shadow-xl p-6 max-w-sm w-full">
 <h3 className="text-[15px] font-bold text-ih-fg-1">
 Unsaved changes
 </h3>
 <p className="text-[13px] text-ih-fg-3 mt-2">
 You have unsaved changes. Are you sure you want to leave?
 </p>
 <div className="flex justify-end gap-2 mt-4">
 <button
 onClick={cancelLeave}
 className="px-4 py-2 text-[13px] font-bold text-slate-600 hover:bg-slate-100 rounded-md"
 >
 Stay
 </button>
 <button
 onClick={confirmLeave}
 className="px-4 py-2 text-[13px] font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-md"
 >
 Leave
 </button>
 </div>
 </div>
 </div>
 )}

 {/* Publish confirmation modal */}
 {state.showPublishModal && (
 <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
 <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => state.setShowPublishModal(false)} />
 <div className="relative bg-ih-bg-card rounded-xl shadow-2xl p-6 max-w-md w-full border border-ih-border">
 <h3 className="text-[16px] font-bold text-ih-fg-1">Publish Report</h3>
 <p className="text-[13px] text-ih-fg-3 mt-2">
 Publishing will finalize this inspection and make the report available to clients.
 {state.progress.pct < 100 && (
 <span className="block mt-2 text-ih-watch font-medium">
 Warning: Only {state.progress.rated} of {state.progress.total} items have been rated ({state.progress.pct}% complete).
 </span>
 )}
 </p>
 <div className="mt-4 p-3 rounded-lg bg-ih-bg-muted text-[12px] space-y-1">
 <div className="flex justify-between"><span className="text-ih-fg-3">Items rated</span><span className="font-bold">{state.progress.rated}/{state.progress.total}</span></div>
 <div className="flex justify-between"><span className="text-ih-fg-3">Completion</span><span className="font-bold">{state.progress.pct}%</span></div>
 <div className="flex justify-between"><span className="text-ih-fg-3">Status</span><span className="font-bold uppercase">{state.inspection.status as string}</span></div>
 </div>
 <div className="flex justify-end gap-2 mt-5">
 <button onClick={() => state.setShowPublishModal(false)} className="px-4 py-2 text-[13px] font-bold text-ih-fg-3 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md">Cancel</button>
 <button
 onClick={() => {
 fetcher.submit({ intent: "publish" }, { method: "post" });
 state.setShowPublishModal(false);
 }}
 className="px-4 py-2 text-[13px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md"
 >Publish Now</button>
 </div>
 </div>
 </div>
 )}

 {/* Inspector sign modal */}
 {signModalOpen && (
 <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
 <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setSignModalOpen(false)} />
 <div className="relative bg-ih-bg-card rounded-xl shadow-2xl p-6 max-w-md w-full border border-ih-border">
 <h3 className="text-[16px] font-bold text-ih-fg-1">Inspector Signature</h3>
 <p className="text-[13px] text-ih-fg-3 mt-2 mb-4">
 Sign this inspection. The signature will be saved and can be included in the published report.
 </p>
 <SignaturePad
 onSubmit={handleSignSubmit}
 onCancel={() => setSignModalOpen(false)}
 label="Save signature"
 />
 {signFetcher.data && !(signFetcher.data as { ok: boolean }).ok && (
 <p className="text-sm text-red-600 mt-2">Failed to save signature. Please try again.</p>
 )}
 </div>
 </div>
 )}

 {/* Comment library drawer */}
 {state.showCommentLibrary && (
 <div className="fixed inset-0 z-[80] flex">
 <div
 className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
 onClick={() => state.setShowCommentLibrary(false)}
 />
 <div className="relative ml-auto w-full max-w-md bg-ih-bg-card border-l border-ih-border shadow-2xl flex flex-col h-full">
 <div className="flex items-center justify-between px-4 py-3 border-b border-ih-border">
 <h3 className="text-[14px] font-bold">Comment Library</h3>
 <button
 onClick={() => state.setShowCommentLibrary(false)}
 className="text-slate-400 hover:text-slate-600 text-lg"
 >
 &#x2715;
 </button>
 </div>

 {/* Sort + Filter mode header */}
 <div className="flex items-center gap-3 px-3 py-2 border-b border-ih-border">
 <div className="flex items-center gap-1.5">
 <span className="text-[10px] uppercase tracking-[0.1em] text-slate-400">Filter</span>
 <select
 value={comments.filterMode}
 onChange={e => comments.setFilterMode(e.target.value as 'auto' | 'all')}
 className="px-2 py-1 rounded border border-ih-border bg-ih-bg-app text-[11px]"
 >
 <option value="auto">Auto</option>
 <option value="all">All</option>
 </select>
 </div>
 <div className="flex items-center gap-1.5 ml-auto">
 <span className="text-[10px] uppercase tracking-[0.1em] text-slate-400">Sort</span>
 <select
 value={comments.sort}
 onChange={e => comments.setSort(e.target.value)}
 className="px-2 py-1 rounded border border-ih-border bg-ih-bg-app text-[11px]"
 >
 <option value="relevance">Relevance</option>
 <option value="recent">Recent use</option>
 <option value="created">Recently added</option>
 <option value="frequent">Most used</option>
 <option value="alpha">A–Z</option>
 </select>
 </div>
 </div>

 {/* Context strip (auto mode + active item) */}
 {comments.filterMode === 'auto' && state.activeItem && (
 <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] bg-ih-bg-muted border-b border-ih-border">
 <span className="text-slate-400">Context:</span>
 <span>
 {state.currentSection?.title} › {(state.activeItem.label || state.activeItem.name) as string}
 </span>
 {Boolean(state.activeItemId && state.getResult(state.activeItemId)?.rating) && (
 <>
 <span className="text-slate-400">·</span>
 <span>
 {state.getRatingLabel?.(state.getResult(state.activeItemId as string)?.rating as string) ?? ''}
 </span>
 </>
 )}
 <button
 onClick={() => comments.setFilterMode('all')}
 className="ml-auto text-slate-400 hover:text-slate-600"
 aria-label="Clear filter"
 >×</button>
 </div>
 )}

 {/* Filter chips */}
 <div className="flex gap-1 px-4 py-2 border-b border-ih-border flex-wrap">
 {[
 { id: "all", label: "All" },
 { id: "satisfactory", label: "Satisfactory" },
 { id: "monitor", label: "Monitor" },
 { id: "defect", label: "Defect" },
 { id: "my-snippets", label: "My Snippets" },
 ].map((f) => (
 <button
 key={f.id}
 onClick={() => {
 state.setCommentLibraryFilter(f.id);
 state.setCommentLibrarySelectedIdx(0);
 }}
 className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${
 state.commentLibraryFilter === f.id
 ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300"
 : "text-slate-400 hover:text-slate-600"
 }`}
 >
 {f.label}
 </button>
 ))}
 </div>

 {/* Search */}
 <div className="px-4 py-2">
 <input
 id="comment-library-search"
 type="text"
 placeholder="Search comments..."
 value={state.commentLibrarySearch}
 onChange={(e) => {
 state.setCommentLibrarySearch(e.target.value);
 state.setCommentLibrarySelectedIdx(0);
 }}
 className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-app text-[12px]"
 autoFocus
 />
 <p className="text-[10px] text-slate-400 mt-1">
 {serverComments.length} comments
 </p>
 </div>

 {/* Comment list (server-fetched, sort/filter aware) */}
 <div className="flex-1 overflow-y-auto pb-2">
 <ul className="divide-y divide-ih-border">
 {serverComments.map((c, idx) => (
 <li
 key={c.id}
 onClick={() => {
 if (!state.currentSection || !state.activeItemId) return;
 findings.insertComment(
 state.currentSection.id,
 state.activeItemId,
 c.text,
 );
 comments.touchSnippet(c.id);
 state.setShowCommentLibrary(false);
 }}
 className={`cursor-pointer ${
 idx === state.commentLibrarySelectedIdx
 ? "bg-ih-primary-tint ring-1 ring-inset ring-indigo-200 dark:ring-indigo-700"
 : ""
 }`}
 >
 <div className="flex items-start gap-2 p-2.5 hover:bg-ih-bg-muted">
 <p className="flex-1 text-[12px] text-ih-fg-2 leading-relaxed">
 {c.text}
 </p>
 <span className="text-[10px] text-slate-400 tabular-nums whitespace-nowrap">
 {comments.sort === 'recent'   && c.lastUsedAt ? formatRelativeTime(c.lastUsedAt) : ''}
 {comments.sort === 'frequent' && c.useCount   ? `${c.useCount}×`               : ''}
 </span>
 </div>
 </li>
 ))}
 </ul>
 {serverComments.length === 0 && (
 <p className="text-[13px] text-ih-fg-3 text-center py-8">
 No comments match the current filter.
 </p>
 )}
 </div>
 </div>
 </div>
 )}

 {/* Section picker modal */}
 {state.sectionPickerOpen && (
 <div className="fixed inset-0 z-[90] flex items-start justify-center pt-[20vh]">
 <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => state.closeSectionPicker()} />
 <div className="relative w-full max-w-md bg-ih-bg-card rounded-xl shadow-2xl border border-ih-border overflow-hidden">
 <div className="px-4 py-3 border-b border-ih-border">
 <input
 id="section-picker-input"
 type="text"
 placeholder="Jump to section..."
 value={state.sectionPickerQuery}
 onChange={(e) => state.setSectionPickerQuery(e.target.value)}
 className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-app text-[13px]"
 autoFocus
 />
 </div>
 <div className="max-h-60 overflow-y-auto">
 {state.filteredSectionsForPicker.map((sec) => (
 <button
 key={sec.idx}
 onClick={() => state.pickSection(sec.idx)}
 className="w-full text-left px-4 py-2.5 text-[13px] hover:bg-ih-bg-muted flex items-center justify-between"
 >
 <span className="font-medium text-ih-fg-1">{sec.title}</span>
 <span className="text-[11px] text-ih-fg-3">{state.sections[sec.idx]?.items?.length || 0} items</span>
 </button>
 ))}
 {state.filteredSectionsForPicker.length === 0 && (
 <p className="text-center text-[13px] text-ih-fg-3 py-6">No sections match</p>
 )}
 </div>
 </div>
 </div>
 )}

 {/* Tag picker modal */}
 {tagPickerOpen && state.activeItemId && (
 <div className="fixed inset-0 z-[95] flex items-start justify-center pt-[20vh]">
  <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setTagPickerOpen(false)} />
  <div className="relative w-full max-w-sm bg-ih-bg-card rounded-xl shadow-2xl border border-ih-border overflow-hidden">
  <div className="px-4 py-3 border-b border-ih-border flex items-center justify-between">
   <h3 className="text-[14px] font-bold text-ih-fg-1">Tags</h3>
   <button
   onClick={() => setTagPickerOpen(false)}
   className="text-slate-400 hover:text-slate-600 text-lg"
   >
   &#x2715;
   </button>
  </div>
  <div className="p-3 space-y-1.5">
   {PRESET_TAGS.map((tag) => {
   const currentTags = state.tagsByItem[state.activeItemId!] || [];
   const isActive = currentTags.some(t => t.id === tag.id);
   return (
    <button
    key={tag.id}
    onClick={() => toggleTag(tag)}
    className={`w-full text-left px-3 py-2.5 rounded-lg text-[13px] font-medium flex items-center gap-3 transition-colors ${
     isActive
     ? "bg-ih-bg-muted ring-1 ring-inset"
     : "hover:bg-slate-50 dark:hover:bg-slate-800/50"
    }`}
    style={isActive ? { "--tw-ring-color": tag.color } as React.CSSProperties : undefined}
    >
    <span
     className="w-3 h-3 rounded-full flex-shrink-0"
     style={{ backgroundColor: tag.color }}
    />
    <span className="flex-1 text-ih-fg-1">{tag.name}</span>
    {isActive && (
     <svg className="w-4 h-4 text-ih-ok" fill="none" stroke="currentColor" viewBox="0 0 24 24">
     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
     </svg>
    )}
    </button>
   );
   })}
  </div>
  {(state.tagsByItem[state.activeItemId!] || []).length > 0 && (
   <div className="px-4 py-2 border-t border-ih-border">
   <div className="flex flex-wrap gap-1.5">
    {(state.tagsByItem[state.activeItemId!] || []).map(tag => (
    <span
     key={tag.id}
     className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold text-white"
     style={{ backgroundColor: tag.color || '#6b7280' }}
    >
     {tag.name}
    </span>
    ))}
   </div>
   </div>
  )}
  </div>
 </div>
 )}

 {/* Publish gate modal */}
 <PublishGateModal
  open={showPublishGate}
  readiness={publishReadiness}
  onClose={() => setShowPublishGate(false)}
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
 <div className="fixed top-0 left-0 right-0 z-50">
 <div className="h-14 bg-ih-bg-card border-b border-ih-border flex items-center px-4 gap-3">
 <a
 href="/dashboard"
 className="w-9 h-9 rounded-md flex items-center justify-center text-ih-fg-3 hover:bg-slate-100 dark:hover:bg-slate-800"
 >
 <svg
 className="w-4 h-4"
 fill="none"
 stroke="currentColor"
 viewBox="0 0 24 24"
 >
 <path
 strokeLinecap="round"
 strokeLinejoin="round"
 strokeWidth={2}
 d="M19 12H5M12 19l-7-7 7-7"
 />
 </svg>
 </a>
 <div className="flex-1 min-w-0">
 <div className="text-[14px] font-bold truncate">
 {(state.inspection.propertyAddress as string) || "Inspection"}
 </div>
 <div className="text-[11px] text-ih-fg-3 truncate">
 #{String(state.inspection.id).slice(0, 8).toUpperCase()}
 {state.formattedDate && (
 <span className="ml-2">{state.formattedDate}</span>
 )}
 </div>
 </div>

 {/* Search */}
 <div className="hidden lg:flex items-center">
 <input
 type="text"
 placeholder="Search report..."
 value={state.searchQuery}
 onChange={(e) => state.setSearchQuery(e.target.value)}
 className="w-44 h-8 px-3 rounded-md border border-ih-border bg-ih-bg-app text-[12px]"
 />
 </div>

 {/* View mode */}
 <div className="hidden lg:flex items-center gap-0.5 bg-slate-100 dark:bg-slate-800 rounded-md p-0.5">
 <button
 onClick={() => state.setViewMode("split")}
 className={`px-2 py-1 rounded text-[11px] font-bold ${state.viewMode === "split" ? "bg-white dark:bg-slate-700 text-ih-fg-1 shadow-sm" : "text-ih-fg-3"}`}
 title="Split view (Cmd+1)"
 >Split</button>
 <button
 onClick={() => state.setViewMode("focus")}
 className={`px-2 py-1 rounded text-[11px] font-bold ${state.viewMode === "focus" ? "bg-white dark:bg-slate-700 text-ih-fg-1 shadow-sm" : "text-ih-fg-3"}`}
 title="Focus view (Cmd+2)"
 >Focus</button>
 </div>

 {/* Batch mode toggle */}
 <button
 onClick={() => {
  if (state.batchMode) {
  state.setBatchMode(false);
  state.setBatchSelected({});
  } else {
  state.setBatchMode(true);
  }
 }}
 className={`hidden lg:flex w-9 h-9 rounded-md items-center justify-center ${
  state.batchMode
  ? "bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400"
  : "text-ih-fg-3 hover:bg-slate-100 dark:hover:bg-slate-800"
 }`}
 title={state.batchMode ? "Exit batch mode" : "Batch mode (B)"}
 >
 <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
 </svg>
 </button>

 {/* Completion progress */}
 {(() => {
 const stats = state.overallStats();
 return (
 <ProgressStripText
 rated={stats.rated}
 total={stats.total}
 defects={stats.defect}
 monitor={stats.monitor}
 etaMinutes={stats.etaMinutes}
 />
 );
 })()}

 {/* Save status indicator */}
 {state.saveStatus !== "idle" && (
 <span
 className={`inline-flex items-center gap-1.5 text-[11px] font-bold ${
 state.saveStatus === "saving"
 ? "text-ih-watch"
 : state.saveStatus === "saved"
 ? "text-ih-ok"
 : "text-ih-bad"
 }`}
 >
 {state.saveStatus === "saving" ? (
 <>
 <span className="w-1.5 h-1.5 rounded-full bg-ih-watch-bg0 animate-pulse" />
 Saving...
 </>
 ) : state.saveStatus === "saved" ? (
 <>
 <svg
 className="w-3.5 h-3.5"
 fill="none"
 stroke="currentColor"
 viewBox="0 0 24 24"
 >
 <path
 strokeLinecap="round"
 strokeLinejoin="round"
 strokeWidth={2}
 d="M5 13l4 4L19 7"
 />
 </svg>
 Saved
 </>
 ) : (
 <>
 <span className="w-1.5 h-1.5 rounded-full bg-ih-bad-bg0" />
 Error
 </>
 )}
 </span>
 )}

 {/* Status badge */}
 <span className="px-2 h-7 rounded-md text-[11px] font-bold uppercase tracking-wide ring-1 ring-inset bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:ring-slate-600 inline-flex items-center">
 {state.inspection.status as string}
 </span>

 {/* Dark mode toggle */}
 <button
 onClick={() => setColorScheme(scheme === 'light' ? 'dark' : scheme === 'dark' ? 'auto' : 'light')}
 className="w-9 h-9 rounded-md flex items-center justify-center text-ih-fg-3 hover:bg-slate-100 dark:hover:bg-slate-800"
 title={`Theme: ${scheme}`}
 >
 {scheme === 'dark' ? (
 <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>
 ) : scheme === 'light' ? (
 <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
 ) : (
 <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
 )}
 </button>

 {/* Settings button */}
 <button
 onClick={() => state.setSettingsOpen(true)}
 className="w-9 h-9 rounded-md flex items-center justify-center text-ih-fg-3 hover:bg-slate-100 dark:hover:bg-slate-800"
 title="Inspection settings"
 >
 <svg
 className="w-4 h-4"
 fill="none"
 stroke="currentColor"
 viewBox="0 0 24 24"
 >
 <path
 strokeLinecap="round"
 strokeLinejoin="round"
 strokeWidth={2}
 d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
 />
 <path
 strokeLinecap="round"
 strokeLinejoin="round"
 strokeWidth={2}
 d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
 />
 </svg>
 </button>

 {/* Auto-sign toggle */}
 <label className="hidden lg:inline-flex items-center gap-1.5 text-[11px] font-medium text-ih-fg-3 cursor-pointer select-none">
 <input
 type="checkbox"
 checked={autoSign}
 onChange={(e) => handleAutoSignToggle(e.target.checked)}
 className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600"
 />
 Auto-sign
 </label>

 {/* Sign now button */}
 <button
 onClick={() => setSignModalOpen(true)}
 className="hidden lg:inline-flex h-9 px-3 rounded-md border border-ih-border text-[12px] font-bold text-ih-fg-2 hover:bg-slate-100 dark:hover:bg-slate-800 items-center gap-1.5"
 title="Sign this inspection now"
 >
 <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
 </svg>
 Sign now
 </button>

 {/* Publish button */}
 <button
 onClick={handlePublishClick}
 className="h-9 px-4 rounded-md bg-emerald-600 text-white font-bold text-[12px] hover:bg-emerald-700 transition-colors inline-flex items-center gap-1.5"
 >
 <svg
 className="w-3.5 h-3.5"
 fill="none"
 stroke="currentColor"
 viewBox="0 0 24 24"
 >
 <path
 strokeLinecap="round"
 strokeLinejoin="round"
 strokeWidth={2}
 d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
 />
 </svg>
 Publish
 </button>
 </div>
 </div>

 {/* ------------------------------------------------------------ */}
 {/* 4-column layout below header */}
 {/* ------------------------------------------------------------ */}
 <div className="flex flex-1 pt-14 pb-9">
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
 state.setInspection((prev: any) => ({
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
  className="px-2 py-0.5 rounded text-[11px] font-bold text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-900/20"
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
 <main className="flex-1 overflow-y-auto border-t-2 border-indigo-600 p-6">
 {itemEditorEl}
 </main>

 {/* Column 4: SideRail */}
 {sideRailEl}
 </div>

 {/* ------------------------------------------------------------ */}
 {/* Footer Bar */}
 {/* ------------------------------------------------------------ */}
 <FooterBar connected={presence.connected} roster={presence.roster} />

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
  setPhotoStudioUrl(`/api/inspections/${state.inspection.id}/photos/${photos[0]}`);
  setPhotoStudioIndex(1);
  setPhotoStudioTotal(photos.length);
 } else {
  setPhotoStudioUrl(null);
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

 {/* Offline reconnect banner */}
 {!offline.online && (
 <div className="fixed top-14 left-0 right-0 z-40 bg-ih-watch-bg border-b border-ih-watch px-4 py-2 text-center">
 <span className="text-[12px] font-bold text-ih-watch-fg">
 You are offline. Changes will sync when you reconnect.
 </span>
 {offline.pendingCount > 0 && (
 <span className="text-[11px] text-ih-watch-fg ml-2">
 ({offline.pendingCount} pending)
 </span>
 )}
 </div>
 )}
 </div>
 );
}
