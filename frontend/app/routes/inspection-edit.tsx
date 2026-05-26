import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useLoaderData, useFetcher, useNavigate } from "react-router";
import type { Route } from "./+types/inspection-edit";
import { requireToken } from "~/lib/session.server";
import { apiFetch } from "~/lib/api.server";
import { useInspectionState } from "~/hooks/useInspection";
import type { RatingLevel, ResultMap } from "~/hooks/useInspection";
import { useFindings } from "~/hooks/useFindings";
import { useKeyboard } from "~/hooks/useKeyboard";
import { useCannedComments } from "~/hooks/useCannedComments";
import { useOfflineQueue } from "~/hooks/useOfflineQueue";
import { useUnsavedChanges } from "~/hooks/useUnsavedChanges";
import { SectionRail } from "~/components/editor/SectionRail";
import { ItemList } from "~/components/editor/ItemList";
import { ItemEditor } from "~/components/editor/ItemEditor";
import { SideRail } from "~/components/editor/SideRail";
import { SpeedMode } from "~/components/editor/SpeedMode";
import { FooterBar } from "~/components/editor/FooterBar";
import { KeyboardHud } from "~/components/editor/KeyboardHud";
import { InspectorToolsDock } from "~/components/editor/InspectorToolsDock";
import { BurstCamera } from "~/components/editor/BurstCamera";
import { PropertyInfoForm } from "~/components/editor/PropertyInfoForm";
import { InspectionSettingsSheet } from "~/components/editor/InspectionSettingsSheet";

export function meta() {
 return [{ title: "Edit Inspection - OpenInspection" }];
}

/* ------------------------------------------------------------------ */
/* Loader */
/* ------------------------------------------------------------------ */

export async function loader({ request, params }: Route.LoaderArgs) {
 const token = await requireToken(request);
 const id = params.id;

 const [inspRes, resultsRes, reportRes] = await Promise.all([
 apiFetch(`/api/inspections/${id}`, { token }),
 apiFetch(`/api/inspections/${id}/results`, { token }),
 apiFetch(`/api/inspections/${id}/report-data`, { token }),
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

export async function action({ request, params }: Route.ActionArgs) {
 const token = await requireToken(request);
 const formData = await request.formData();
 const intent = formData.get("intent");

 if (intent === "rate") {
 const itemId = String(formData.get("itemId"));
 const sectionId = String(formData.get("sectionId"));
 const rating = String(formData.get("rating"));
 await apiFetch(`/api/inspections/${params.id}/items/${itemId}/field`, {
 method: "PATCH",
 token,
 body: JSON.stringify({ field: "rating", value: rating, sectionId }),
 });
 }

 if (intent === "notes") {
 const itemId = String(formData.get("itemId"));
 const sectionId = String(formData.get("sectionId"));
 const notes = String(formData.get("notes"));
 await apiFetch(`/api/inspections/${params.id}/items/${itemId}/field`, {
 method: "PATCH",
 token,
 body: JSON.stringify({ field: "notes", value: notes, sectionId }),
 });
 }

 if (intent === "toggle-canned") {
 const itemId = String(formData.get("itemId"));
 const sectionId = String(formData.get("sectionId"));
 const tabName = String(formData.get("tabName"));
 const cannedId = String(formData.get("cannedId"));
 const included = formData.get("included") === "true";
 await apiFetch(`/api/inspections/${params.id}/items/${itemId}/field`, {
 method: "PATCH",
 token,
 body: JSON.stringify({
 field: "cannedToggle",
 value: { tabName, cannedId, included },
 sectionId,
 }),
 });
 }

 if (intent === "save-all") {
 const data = formData.get("data");
 if (data) {
 await apiFetch(`/api/inspections/${params.id}/results`, {
 method: "PATCH",
 token,
 body: JSON.stringify({ data: JSON.parse(String(data)) }),
 });
 }
 }

 return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Component */
/* ------------------------------------------------------------------ */

export default function InspectionEditPage() {
 const loaderData = useLoaderData<typeof loader>();
 const fetcher = useFetcher();
 const navigate = useNavigate();
 const photoInputRef = useRef<HTMLInputElement>(null);

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
 /* Canned comments library */
 /* ---------------------------------------------------------------- */

 const comments = useCannedComments({
 inspectionId: String(state.inspection.id),
 bucketForRatingId: state.bucketForRatingId,
 });

 /* ---------------------------------------------------------------- */
 /* Offline queue */
 /* ---------------------------------------------------------------- */

 const offline = useOfflineQueue();

 /* ---------------------------------------------------------------- */
 /* Unsaved changes guard */
 /* ---------------------------------------------------------------- */

 const { blocker, confirmLeave, cancelLeave } = useUnsavedChanges(state.dirty);

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
 setTimeout(() => state.advanceToNextUnrated(), 150);
 },
 [state.activeItemId, state.currentSection, findings, state.advanceToNextUnrated],
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
 commentLibraryItems.length - 1,
 ),
 );
 },
 onLibraryUp: () => {
 state.setCommentLibrarySelectedIdx(
 Math.max(state.commentLibrarySelectedIdx - 1, 0),
 );
 },
 onLibrarySelect: () => {
 const sel = commentLibraryItems[state.commentLibrarySelectedIdx];
 if (sel && state.activeItemId && state.currentSection) {
 findings.insertComment(
 state.currentSection.id,
 state.activeItemId,
 sel.text,
 );
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
 onRepeatRating: () => {
 if (!state.activeItemId || !state.currentSection) return;
 findings.repeatPreviousRating(
 state.currentSection.id,
 state.activeItemId,
 state.currentSectionItems,
 );
 },
 onSaveAsSnippet: () => {
 if (!state.activeItemId) return;
 const r = state.getResult(state.activeItemId);
 const notes = ((r?.notes as string) || "").trim();
 if (!notes) return;
 const bucket = state.bucketForRatingId(r?.rating as string);
 const section = state.currentSection?.title || "";
 comments.saveSnippet(notes, bucket, section);
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
 // Tag picker not yet wired in Remix — placeholder
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
 /* Render */
 /* ---------------------------------------------------------------- */

 return (
 <div className="flex h-screen bg-ih-bg-card">
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
 {commentLibraryItems.length} comments
 </p>
 </div>

 {/* Comment list */}
 <div className="flex-1 overflow-y-auto px-4 space-y-1 pb-4">
 {commentLibraryItems.map((entry, idx) => (
 <button
 key={`${entry.text.slice(0, 30)}-${idx}`}
 onClick={() => {
 if (state.activeItemId && state.currentSection) {
 findings.insertComment(
 state.currentSection.id,
 state.activeItemId,
 entry.text,
 );
 state.setShowCommentLibrary(false);
 }
 }}
 className={`w-full text-left p-2.5 rounded-lg text-[12px] transition-colors ${
 idx === state.commentLibrarySelectedIdx
 ? "bg-ih-primary-tint ring-1 ring-indigo-200 dark:ring-indigo-700"
 : "hover:bg-slate-50 dark:hover:bg-slate-800"
 }`}
 >
 <span className="text-ih-fg-2 leading-relaxed">
 {entry.text}
 </span>
 {entry.section && (
 <span className="block text-[10px] text-slate-400 mt-0.5">
 {entry.section}
 </span>
 )}
 </button>
 ))}
 {commentLibraryItems.length === 0 && (
 <p className="text-[13px] text-ih-fg-3 text-center py-8">
 No comments match the current filter.
 </p>
 )}
 </div>
 </div>
 </div>
 )}

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

 {/* Completion progress */}
 <div className="flex items-center gap-2">
 <div className="w-24 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
 <div
 className="h-full bg-ih-primary dark:bg-indigo-500 rounded-full transition-all duration-300"
 style={{ width: `${state.progress.pct}%` }}
 />
 </div>
 <span className="text-[11px] font-mono text-ih-fg-3 whitespace-nowrap">
 {state.progress.rated}/{state.progress.total}
 </span>
 </div>

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

 {/* Publish button */}
 <button
 onClick={() => state.setShowPublishModal(true)}
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
 <SectionRail
 sections={state.sections}
 activeSection={state.currentSection?.id || ""}
 onSelect={(id) => {
 state.selectSectionById(id);
 }}
 results={state.results}
 />

 {/* Column 2: Item List (280px) OR Property Info */}
 {state.activeView === "property" ? (
 <div className="w-[280px] flex-shrink-0 border-r border-ih-border overflow-y-auto">
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
 <ItemList
 items={visibleItems}
 sectionId={state.currentSection?.id || ""}
 activeItemId={state.activeItemId}
 onSelect={(id) => state.setActiveItemId(id)}
 results={state.results}
 />
 )}

 {/* Column 3: Item Editor (flex-1, focal) */}
 <main className="flex-1 overflow-y-auto border-t-2 border-indigo-600 p-6">
 {state.activeItemId ? (
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
 )}
 </main>

 {/* Column 4: SideRail */}
 <SideRail
 activeItem={state.activeItem}
 />
 </div>

 {/* ------------------------------------------------------------ */}
 {/* Footer Bar */}
 {/* ------------------------------------------------------------ */}
 <FooterBar />

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
 // Photo studio not yet in Remix — placeholder
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
