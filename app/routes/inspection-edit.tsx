import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useLoaderData, useFetcher, useNavigate, useRevalidator } from "react-router";
import type { Route } from "./+types/inspection-edit";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { unwrapResultsResponse } from "~/lib/results";
import { findRatingLevel, ratingAdvanceDecision } from "~/lib/rating-levels";
import { makeCustomDefect } from "~/lib/custom-defects";
import { sanitizeSettingsPatch } from "~/lib/settings-patch";
import { useInspectionState, type InspectionSchema } from "~/hooks/useInspection";
import type { RatingLevel, ResultMap } from "~/hooks/useInspection";
import { useFindings, type AttachedRepairItem } from "~/hooks/useFindings";
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
import { PhotoAnnotator } from "~/components/media-studio/PhotoAnnotator";
import { PropertyInfoForm } from "~/components/editor/PropertyInfoForm";
import { InspectionSettingsSheet } from "~/components/editor/InspectionSettingsSheet";
import { CoverCropper } from "~/components/media-studio/CoverCropper";
import { PhotoCropper, type PhotoCrop } from "~/components/media-studio/PhotoCropper";
import { resolvePhotoDisplayKey, clearAnnotationOnRecrop } from "~/components/media-studio/photo-display-key";
import { MediaViewer, type MediaAction } from "~/components/media-studio/MediaViewer";
import { PosterPicker, streamThumbUrl } from "~/components/media-studio/PosterPicker";
import { VideoCapture } from "~/components/media-studio/VideoCapture";
import type { GalleryPhoto } from "~/lib/inspection-media";
import { fKey } from "~/hooks/useInspection";
import { fullResUrl } from "~/components/media-studio/cropImage";
import { preprocessImage } from "~/components/media-studio/preprocessImage";
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

export async function loader({ request, params, context }: Route.LoaderArgs) {
 const token = await requireToken(context, request);
 const id = params.id;

 const api = createApi(context, { token });
 const [inspRes, resultsRes, reportRes, tagsRes, sessRes] = await Promise.all([
 api.inspections[":id"].$get({ param: { id } }),
 api.inspections[":id"].results.$get({ param: { id } }),
 api.inspections[":id"]["report-data"].$get({ param: { id } }),
 // Track H (C-12): tag library moved off the client-side fetch into the loader.
 api.tags.index.$get().catch(() => null),
 // tenantSlug for the "Preview full report" link (/report-view/:slug/:id).
 api.sessionContext.context.$get().catch(() => null),
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
 // templateSnapshot may arrive as a JSON string (wizard-created inspections)
 // — parse before use, mirroring form-renderer.tsx. Mutating a string here
 // 500'd the whole editor.
 const rawSchema = data?.templateSnapshot ||
 (data?.template as Record<string, unknown>)?.schema;
 const schema = ((typeof rawSchema === "string"
 ? JSON.parse(rawSchema)
 : rawSchema) as {
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
 // B-17: the endpoint nests the map under data.results — unwrap via the
 // shared helper so persisted ratings survive a reload.
 const results = unwrapResultsResponse(resultsBody) as ResultMap;

 let tagLibrary: Array<{ id: string; name: string; color: string }> = [];
 if (tagsRes?.ok) {
 const tagsBody = await tagsRes.json() as { data?: Array<{ id: string; name: string; color: string }> };
 tagLibrary = tagsBody.data ?? [];
 }

 let tenantSlug: string | null = null;
 if (sessRes?.ok) {
 const sb = await sessRes.json() as { data?: { branding?: { tenantSlug?: string | null } } };
 tenantSlug = sb.data?.branding?.tenantSlug ?? null;
 }

 // Plan 7 — the Stream customer subdomain (env) drives video poster thumbnails
 // + the player iframe. Absent ⇒ null; the viewer/strip fail closed gracefully
 // (no fabricated subdomain).
 const streamCustomerSubdomain =
   ((context.cloudflare?.env as { STREAM_CUSTOMER_SUBDOMAIN?: string } | undefined)?.STREAM_CUSTOMER_SUBDOMAIN) ?? null;

 return { inspection, schema, results, ratingLevels, token, tagLibrary, tenantSlug, streamCustomerSubdomain };
}

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

export async function action({ request, params, context }: Route.ActionArgs) {
 const token = await requireToken(context, request);
 const formData = await request.formData();
 const intent = formData.get("intent");
 const api = createApi(context, { token });
 // B-17: every branch must record whether the API write actually landed —
 // returning { ok: true } unconditionally turned failed PATCHes into silent
 // data loss (the save pill said "Saved" either way).
 let ok = true;

 if (intent === "rate") {
 const itemId = String(formData.get("itemId"));
 const sectionId = String(formData.get("sectionId"));
 const rating = String(formData.get("rating"));
 const res = await api.inspections[":id"].items[":itemId"].$patch({
 param: { id: params.id, itemId },
 json: { field: "rating", value: rating, sectionId, expectedVersion: 0, force: true },
 });
 ok = res.ok;
 }

 if (intent === "notes") {
 const itemId = String(formData.get("itemId"));
 const sectionId = String(formData.get("sectionId"));
 const notes = String(formData.get("notes"));
 const res = await api.inspections[":id"].items[":itemId"].$patch({
 param: { id: params.id, itemId },
 json: { field: "notes", value: notes, sectionId, expectedVersion: 0, force: true },
 });
 ok = res.ok;
 }

 if (intent === "toggle-canned") {
 const itemId = String(formData.get("itemId"));
 const sectionId = String(formData.get("sectionId"));
 const tabName = String(formData.get("tabName"));
 const cannedId = String(formData.get("cannedId"));
 const included = formData.get("included") === "true";
 const res = await api.inspections[":id"].items[":itemId"].$patch({
 param: { id: params.id, itemId },
 json: {
 field: "cannedToggle",
 value: { tabName, cannedId, included },
 sectionId,
 expectedVersion: 0,
 force: true,
 },
 });
 ok = res.ok;
 }

 if (intent === "set-defect-fields") {
 const itemId = String(formData.get("itemId"));
 const sectionId = String(formData.get("sectionId"));
 const cannedId = String(formData.get("cannedId"));
 const patch = JSON.parse(String(formData.get("patch")));
 const res = await api.inspections[":id"].items[":itemId"].$patch({
 param: { id: params.id, itemId },
 json: {
 field: "defectFields",
 value: { cannedId, ...patch },
 sectionId,
 expectedVersion: 0,
 force: true,
 },
 });
 ok = res.ok;
 }

 if (intent === "set-item-attribute") {
 const itemId = String(formData.get("itemId"));
 const attributeId = String(formData.get("attributeId"));
 const value = JSON.parse(String(formData.get("value")));
 const res = await api.inspections[":id"].items[":itemId"].$patch({
 param: { id: params.id, itemId },
 json: {
 field: "itemAttribute",
 value: { attributeId, value },
 expectedVersion: 0,
 force: true,
 },
 });
 ok = res.ok;
 }

 if (intent === "save-all") {
 const data = formData.get("data");
 if (data) {
 const res = await api.inspections[":id"].results.$patch({
 param: { id: params.id },
 json: { data: JSON.parse(String(data)) },
 });
 ok = res.ok;
 }
 }

 if (intent === "publish") {
 const res = await api.inspections[":id"].publish.$post({ param: { id: params.id }, json: {} });
 // Publish has meaningful precondition failures (e.g. "Inspection must be
 // completed before publishing the report.") that the inspector MUST see —
 // returning a bare { ok:false } here routed the publish through the generic
 // autosave "Save failed" toast and swallowed the real reason. Parse the
 // AppError body ({ error: { code, message } }) and carry the message back
 // so the publish modal can show it inline.
 if (!res.ok) {
 const bodyText = await res.text().catch(() => "");
 let message = "Couldn't publish the report. Please try again.";
 try {
 const parsed = JSON.parse(bodyText) as { error?: { message?: string }; message?: string };
 message = parsed?.error?.message ?? parsed?.message ?? message;
 } catch {
 /* non-JSON body — keep the default message */
 }
 return { ok: false as const, intent: "publish", error: message };
 }
 return { ok: true as const, intent: "publish" };
 }

 // B-22 follow-up (C-12 class): the settings sheet's "Save changes" used to
 // do a raw client-side fetch('/api/inspections/:id', PATCH) which could never
 // pass requireCsrfToken (the __Host-csrf cookie can't be set by client JS and
 // the pair is attached server-side only) — every save 401/403'd silently.
 // Route it through the BFF relay like every other mutation.
 if (intent === "save-settings") {
 const payload = JSON.parse(String(formData.get("payload") ?? "{}"));
 // The sheet forwards its WHOLE form; sanitize at the BFF boundary so
 // empty-string "unchanged" fields and date-only <input type=date> values
 // pass UpdateInspectionSchema (date wants ISO datetime, price a number).
 const res = await api.inspections[":id"].$patch({
 param: { id: params.id },
 json: sanitizeSettingsPatch(payload),
 });
 if (!res.ok) {
 // Surface the API rejection in the worker log — a silent { ok:false }
 // already cost two debugging rounds on this path.
 console.error("[save-settings] PATCH failed", res.status, await res.text().catch(() => ""));
 }
 return { ok: res.ok, intent: "save-settings" };
 }

 if (intent === "set-cover") {
 // DB-16 — set/clear the report cover photo. The value is the R2 key of a
 // photo belonging to this inspection (validated server-side); empty clears.
 const raw = formData.get("coverPhotoId");
 const coverPhotoId = raw ? String(raw) : null;
 const res = await api.inspections[":id"].$patch({
 param: { id: params.id },
 json: { coverPhotoId },
 });
 return { ok: res.ok, intent: "set-cover" };
 }

 if (intent === "upload-cover") {
 // DB-16 — direct cover upload (Spectora parity): upload an image to the
 // loose media pool, then set it as the report cover in one step. Rides the
 // BFF relay like every other mutation (no raw client fetch).
 const file = formData.get("file");
 if (!(file instanceof File)) return { ok: false as const, intent: "upload-cover" };
 const up = await api.inspections[":id"].media.upload.$post({
 param: { id: params.id },
 form: { file },
 });
 if (!up.ok) return { ok: false as const, intent: "upload-cover" };
 const body = (await up.json()) as { data?: { key?: string; url?: string } };
 const key = body.data?.key;
 if (!key) return { ok: false as const, intent: "upload-cover" };
 const patch = await api.inspections[":id"].$patch({
 param: { id: params.id },
 json: { coverPhotoId: key },
 });
 // Return the uploaded photo's key + url so the sheet can append it to the
 // grid locally — avoids reloading (and visibly flickering) the whole sheet.
 return { ok: patch.ok, intent: "upload-cover", coverKey: key, coverUrl: body.data?.url ?? null };
 }

 if (intent === "crop-cover") {
 const image = formData.get("image");
 const sourceKey = String(formData.get("sourceKey") ?? "");
 const crop = String(formData.get("crop") ?? "");
 if (!(image instanceof File) || !sourceKey) return { ok: false as const, intent: "crop-cover" };
 const res = await api.inspections[":id"].cover.$post({
 param: { id: params.id },
 form: { image, sourceKey, crop },
 });
 const body = (await res.json().catch(() => null)) as { data?: { coverImageKey?: string } } | null;
 return { ok: res.ok, intent: "crop-cover", coverKey: body?.data?.coverImageKey ?? null };
 }

 if (intent === "annotate") {
 const image = formData.get("image");
 const itemId = String(formData.get("itemId") ?? "");
 const photoIndex = Number(formData.get("photoIndex") ?? "-1");
 const nodes = String(formData.get("nodes") ?? "[]");
 const sectionId = String(formData.get("sectionId") ?? "");
 if (!(image instanceof File) || !itemId || photoIndex < 0) return { ok: false as const, intent: "annotate" };
 const res = await api.inspections[":id"].items[":itemId"].photos[":photoIndex"].annotation.$post({
 param: { id: params.id, itemId, photoIndex: String(photoIndex) },
 form: sectionId ? { image, nodes, sectionId } : { image, nodes },
 });
 return { ok: res.ok, intent: "annotate" };
 }

 if (intent === "toggle-auto-sign") {
 const autoSignOnPublish = formData.get("autoSignOnPublish") === "true";
 const res = await api.inspections[":id"].$patch({
 param: { id: params.id },
 json: { autoSignOnPublish },
 });
 ok = res.ok;
 }

 if (intent === "sign-inspector") {
 const signatureBase64 = String(formData.get("signatureBase64") ?? "");
 if (signatureBase64) {
 const res = await api.inspectionSync[":id"]["inspector-signature"].$post({
 param: { id: params.id },
 json: { signatureBase64, signedAt: Date.now() },
 });
 ok = res.ok;
 }
 }

 // FE-2: photo upload rides the BFF relay like every other mutation —
 // the old client-side fetch('/api/…/upload') was unauthenticated in saas
 // (C-12 class). Accepts one or many files (burst camera) per submission.
 // FE-3: optional targetType='defect' + customId pins the photo to a
 // specific defect row; defectKind ('canned' | 'custom') is a client-side
 // routing hint echoed back so the effect attaches the key to the right
 // store (it never reaches the API).
 if (intent === "upload-photo") {
 const itemId = String(formData.get("itemId"));
 const targetType = formData.get("targetType") === "defect" ? ("defect" as const) : ("item" as const);
 const customId = String(formData.get("customId") ?? "");
 const defectKind = formData.get("defectKind") === "custom" ? ("custom" as const) : ("canned" as const);
 const files = formData.getAll("file").filter((f): f is File => f instanceof File);
 const keys: string[] = [];
 ok = files.length > 0 && Boolean(itemId);
 for (const file of files) {
 const res = await api.inspections[":id"].upload.$post({
 param: { id: params.id },
 form: {
 file,
 itemId,
 ...(targetType === "defect" ? { targetType, customId } : {}),
 },
 });
 if (res.ok) {
 const j = (await res.json()) as { data?: { key?: string } };
 if (j.data?.key) keys.push(j.data.key);
 else ok = false;
 } else {
 ok = false;
 }
 }
 return { ok, keys, itemId, targetType, customId, defectKind };
 }

 // ── Offline replay intents ────────────────────────────────────────────────
 //
 // The offline ActionTransport cannot parse React Router's turbo-stream body,
 // so it can't distinguish a plain 200 from an {ok:false} result buried in the
 // stream.  These two dedicated intents return Response.json() with an explicit
 // HTTP status code so the transport can read res.status directly.
 //
 // replay-write: forwards the original intent payload through the same API
 // call as if it had been submitted online.  Returns:
 //   200 → success
 //   409 → field-version conflict (pass through to the conflict-resolver UI)
 //   4xx/5xx → active error (OfflineQueue will retry up to MAX_ATTEMPTS)
 //
 // replay-photo: forwards a single file upload (blob) to the photo upload API.

 if (intent === "replay-write") {
  const replayIntent = String(formData.get("replayIntent") ?? "");
  const itemId = String(formData.get("itemId") ?? "");
  let sectionId = String(formData.get("sectionId") ?? "");
  let payload: Record<string, unknown> = {};
  try {
   payload = JSON.parse(String(formData.get("payload") ?? "{}"));
  } catch {
   return Response.json({ ok: false, apiStatus: 400 }, { status: 400 });
  }

  // The transport carries sectionId inside the JSON payload (not as a top-level
  // form field) — fall back to it so replays don't 400 with an empty sectionId.
  if (!sectionId && typeof payload.sectionId === "string") sectionId = payload.sectionId;

  // Collect status/ok from whichever API call fires — extracted immediately
  // so we never hold a ClientResponse<...> in a wider-typed variable.
  let apiStatus = 500;
  let apiOk = false;

  // Optimistic-concurrency on replay: unlike the ONLINE single-field path
  // (which deliberately force-writes — pre-existing, out of scope here), an
  // offline write is replayed against state that may have moved while we were
  // offline. useFindings froze the field's last-known version into the
  // payload at enqueue time, so we forward it as a REAL check (force:false).
  // The server returns 409 on a stale version, which propagates below via the
  // explicit-status Response.json so the conflict path can pick it up. A
  // missing version (legacy entry / older queued write) defaults to 0, which
  // decideFieldWrite treats as the initial counter.
  const expectedVersion =
   typeof payload.expectedVersion === "number" ? payload.expectedVersion : 0;

  if (replayIntent === "rate") {
   const rating = String(payload.rating ?? "");
   const r = await api.inspections[":id"].items[":itemId"].$patch({
    param: { id: params.id, itemId },
    json: { field: "rating", value: rating, sectionId, expectedVersion, force: false },
   });
   apiStatus = r.status; apiOk = r.ok;
  } else if (replayIntent === "notes") {
   const notes = String(payload.notes ?? "");
   const r = await api.inspections[":id"].items[":itemId"].$patch({
    param: { id: params.id, itemId },
    json: { field: "notes", value: notes, sectionId, expectedVersion, force: false },
   });
   apiStatus = r.status; apiOk = r.ok;
  } else if (replayIntent === "toggle-canned") {
   const tabName = String(payload.tabName ?? "");
   const cannedId = String(payload.cannedId ?? "");
   const included = Boolean(payload.included);
   const r = await api.inspections[":id"].items[":itemId"].$patch({
    param: { id: params.id, itemId },
    json: {
     field: "cannedToggle",
     value: { tabName, cannedId, included },
     sectionId,
     expectedVersion,
     force: false,
    },
   });
   apiStatus = r.status; apiOk = r.ok;
  } else if (replayIntent === "set-defect-fields") {
   const cannedId = String(payload.cannedId ?? "");
   // payload was validated when originally dispatched; the enum fields were
   // already type-safe at the call site. Use `as any` at the API boundary
   // since the replay path cannot re-run the original runtime type narrowing.
   // Strip transport-only keys (sectionId is a separate json field;
   // expectedVersion is the concurrency control, not a defect attribute) so
   // they don't leak into the defectFields value object.
   // eslint-disable-next-line @typescript-eslint/no-unused-vars
   const { sectionId: _sid, expectedVersion: _ev, ...defectPatch } = payload;
   // eslint-disable-next-line @typescript-eslint/no-explicit-any
   const defectValue = { cannedId, ...(defectPatch as any) } as any;
   const r = await api.inspections[":id"].items[":itemId"].$patch({
    param: { id: params.id, itemId },
    json: { field: "defectFields", value: defectValue, sectionId, expectedVersion, force: false },
   });
   apiStatus = r.status; apiOk = r.ok;
  } else if (replayIntent === "save-all") {
   const r = await api.inspections[":id"].results.$patch({
    param: { id: params.id },
    json: { data: payload },
   });
   apiStatus = r.status; apiOk = r.ok;
  } else {
   // Unknown replayIntent — reject so the entry doesn't loop.
   return Response.json({ ok: false, apiStatus: 400 }, { status: 400 });
  }

  return Response.json({ ok: apiOk, apiStatus }, { status: apiStatus });
 }

 if (intent === "replay-photo") {
  const itemId = String(formData.get("itemId") ?? "");
  const file = formData.get("file");
  if (!file || !(file instanceof File) || !itemId) {
   return Response.json({ ok: false, apiStatus: 400 }, { status: 400 });
  }
  const apiRes = await api.inspections[":id"].upload.$post({
   param: { id: params.id },
   form: { file, itemId },
  });
  const apiStatus = apiRes.status;
  const apiOk = apiRes.ok;
  let key: string | undefined;
  if (apiOk) {
   try {
    const j = (await apiRes.json()) as { data?: { key?: string } };
    key = j.data?.key;
   } catch { /* ignore */ }
  }
  return Response.json({ ok: apiOk && Boolean(key), apiStatus, key }, { status: apiStatus });
 }

 // Task 9c — replay a baked annotation PNG queued offline. Mirrors replay-photo
 // but forwards to the annotation endpoint exactly like the online "annotate"
 // branch above (the queued blob is already the flattened derivative).
 if (intent === "replay-annotation") {
  const itemId = String(formData.get("itemId") ?? "");
  const photoIndex = Number(formData.get("photoIndex") ?? "-1");
  const nodes = String(formData.get("nodes") ?? "[]");
  const sectionId = String(formData.get("sectionId") ?? "");
  const image = formData.get("image");
  if (!(image instanceof File) || !itemId || photoIndex < 0) {
   return Response.json({ ok: false, apiStatus: 400 }, { status: 400 });
  }
  const apiRes = await api.inspections[":id"].items[":itemId"].photos[":photoIndex"].annotation.$post({
   param: { id: params.id, itemId, photoIndex: String(photoIndex) },
   form: sectionId ? { image, nodes, sectionId } : { image, nodes },
  });
  return Response.json({ ok: apiRes.ok, apiStatus: apiRes.status }, { status: apiRes.status });
 }

 // Plan 4 Q3 — replay a baked crop derivative queued offline. Mirrors
 // replay-photo but forwards to the crop endpoint and reads the croppedKey back.
 if (intent === "replay-crop") {
  const itemId = String(formData.get("itemId") ?? "");
  const file = formData.get("file");
  const photoIndex = Number(formData.get("photoIndex"));
  const crop = String(formData.get("crop") ?? "");
  const sectionId = String(formData.get("sectionId") ?? "");
  if (!file || !(file instanceof File) || !itemId || !Number.isInteger(photoIndex) || photoIndex < 0) {
   return Response.json({ ok: false, apiStatus: 400 }, { status: 400 });
  }
  const apiRes = await api.inspections[":id"].items[":itemId"].photos[":photoIndex"].crop.$post({
   param: { id: params.id, itemId, photoIndex: String(photoIndex) },
   form: sectionId ? { image: file, crop, sectionId } : { image: file, crop },
  });
  const apiStatus = apiRes.status;
  const apiOk = apiRes.ok;
  let croppedKey: string | undefined;
  if (apiOk) {
   try {
    const j = (await apiRes.json()) as { data?: { croppedKey?: string } };
    croppedKey = j.data?.croppedKey;
   } catch { /* ignore */ }
  }
  return Response.json({ ok: apiOk && Boolean(croppedKey), apiStatus, croppedKey }, { status: apiStatus });
 }

 return { ok };
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
 // Media Studio — gallery "Set as cover" opens an editor-level CoverCropper.
 const [galleryCropSource, setGalleryCropSource] = useState<{ key: string; url: string } | null>(null);
 // Plan 4 (Task 8) — per-photo crop. `photoCropTarget` opens the PhotoCropper for
 // an item/defect photo (cropping ALWAYS re-derives from the ORIGINAL key).
 const [photoCropTarget, setPhotoCropTarget] = useState<{
   itemId: string; photoIndex: number; sourceUrl: string; hasAnnotation: boolean; sectionId?: string;
 } | null>(null);
 // Plan 4 — re-crop warning modal: a crop that would discard an existing
 // annotation defers behind a confirm (no native window.confirm).
 const [recropWarn, setRecropWarn] = useState<{ run: () => void } | null>(null);

 /* Task 8 — unified MediaViewer for an item's photo strip. `viewer` holds the
  * item being viewed + the open index. Photos are mapped item-result → GalleryPhoto[]
  * on demand so the viewer reflects the live (optimistic) results map. A null
  * index means "closed". A dedicated fetcher persists reorder/detach/revert
  * (per-photo POSTs, separate from the shared save-all fetcher). */
 const [viewer, setViewer] = useState<{ itemId: string; index: number | null }>({ itemId: "", index: null });
 const photoOpsFetcher = useFetcher();

 /* Plan 7 — Stream customer subdomain (from loader env). Null ⇒ fail closed:
  * video posters/players render a graceful "unavailable" state, never a
  * fabricated subdomain. */
 const streamCustomerSubdomain = loaderData.streamCustomerSubdomain ?? null;

 /* Plan 7 — resolve a Stream poster thumbnail URL for a video strip thumb. */
 const videoPosterUrl = useCallback(
  (streamUid: string, posterPct?: number): string | null => {
   if (!streamCustomerSubdomain) return null;
   // poster sec is unknown without duration here; the thumbnail endpoint accepts
   // a pct-derived time only when we know duration — fall back to time=0s, which
   // Stream maps to the configured thumbnailTimestampPct poster anyway.
   const sec = 0;
   void posterPct;
   return streamThumbUrl(streamCustomerSubdomain, streamUid, sec);
  },
  [streamCustomerSubdomain],
 );

 /* Plan 7 — PosterPicker target (a video entry being re-postered). */
 const [posterTarget, setPosterTarget] = useState<
  { streamUid: string; durationSec: number; posterPct: number } | null
 >(null);

 /* Task 8 — the report cover key (DB-16): a photo whose displayKey matches this
  * rings as the cover in the strip + carries the "Set cover" toggle in the viewer. */
 const coverKey = (state.inspection.coverPhotoId as string | null) ?? null;

 /* Task 8 — read an item's stored photos[] (item-level bucket) from the live
  * results map. Item photos are `{ key; croppedKey?; crop?; annotatedKey?; annotationsJson? }`. */
 type ItemCrop = { aspect: string; orientation: "landscape" | "portrait"; x: number; y: number; width: number; height: number };
 type ItemPhoto = { key: string; croppedKey?: string; crop?: ItemCrop; annotatedKey?: string; annotationsJson?: string; mediaType?: "photo" | "video"; streamUid?: string; posterPct?: number; durationSec?: number };
 const getItemPhotos = useCallback(
  (itemId: string): ItemPhoto[] => {
   const r = findings.getResult(itemId, state.sectionIdForItem(itemId) ?? undefined);
   return ((r.photos as ItemPhoto[] | undefined) ?? []);
  },
  [findings, state.sectionIdForItem],
 );

 /* Task 8 — map an item's photos[] → GalleryPhoto[] for the unified MediaViewer.
  * displayKey (annotatedKey||key) drives the rendered image + URL; originalKey
  * keeps the un-annotated source; photoIndex addresses detach/revert; annotated
  * gates the Revert button. itemId is threaded so onAction knows the target. */
 const itemGalleryPhotos = useCallback(
  (itemId: string): GalleryPhoto[] =>
   getItemPhotos(itemId).map((p, i) => {
    const dk = resolvePhotoDisplayKey(p);
    return {
     key: dk,
     url: `/api/inspections/${state.inspection.id}/photo?key=${encodeURIComponent(dk)}`,
     label: "",
     itemId,
     photoIndex: i,
     annotated: !!p.annotatedKey,
     originalKey: p.key,
     croppedKey: p.croppedKey,
     // Plan 7 — carry the media kind so the viewer/strip branch on video.
     mediaType: p.mediaType,
     streamUid: p.streamUid,
     posterPct: p.posterPct,
     durationSec: p.durationSec,
    };
   }),
  [getItemPhotos, state.inspection.id],
 );

 /* Task 8 — open the viewer for an item at index i. */
 const onOpenPhoto = useCallback((itemId: string, index: number) => {
  setViewer({ itemId, index });
 }, []);

 /* Task 8 — optimistically apply a photos[] transform to BOTH result keys
  * (composite + bare itemId), mirroring useFindings' dual-write. */
 const patchItemPhotos = useCallback(
  (itemId: string, next: (photos: ItemPhoto[]) => ItemPhoto[]) => {
   const sid = state.sectionIdForItem(itemId);
   const ck = sid ? fKey(sid, itemId) : itemId;
   state.setResults((prev) => {
    const existing = ((prev[ck] as Record<string, unknown>) || (prev[itemId] as Record<string, unknown>) || {});
    const photos = next(((existing.photos as ItemPhoto[]) ?? []));
    const updated = { ...existing, photos };
    return { ...prev, [ck]: updated, [itemId]: updated };
   });
   state.setDirty(true);
  },
  [state.sectionIdForItem, state.setResults, state.setDirty],
 );

 /* Task 8 — persist a reorder. CONTRACT: `order` is the ORIGINAL key order
  * (the server reorderItemPhotos route matches photos[].key). Optimistically
  * reorder local state by key, then POST. */
 const onReorderPhotos = useCallback(
  (itemId: string, order: string[]) => {
   patchItemPhotos(itemId, (photos) => {
    const byKey = new Map(photos.map((p) => [p.key, p] as const));
    const reordered = order.map((k) => byKey.get(k)).filter((p): p is ItemPhoto => !!p);
    return reordered.length === photos.length ? reordered : photos;
   });
   photoOpsFetcher.submit(null, {
    method: "POST",
    action: `/api/inspections/${state.inspection.id}/items/${itemId}/photos/reorder`,
    encType: "application/json",
    body: JSON.stringify({ order, sectionId: state.currentSection?.id }),
   } as Parameters<typeof photoOpsFetcher.submit>[1]);
  },
  [patchItemPhotos, photoOpsFetcher, state.inspection.id, state.currentSection],
 );

 /* Task 9 — bulk-detach photos by index. The strip emits indices DESC so each
  * detach keeps the remaining (lower) indices valid; we POST highest-first too. */
 const onBulkDetachPhotos = useCallback(
  (itemId: string, indices: number[]) => {
   patchItemPhotos(itemId, (photos) => photos.filter((_, i) => !indices.includes(i)));
   const sectionId = state.currentSection?.id;
   (async () => {
    for (const idx of indices) {
     await fetch(`/api/inspections/${state.inspection.id}/items/${itemId}/photos/${idx}/detach`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sectionId }),
     });
    }
    revalidator.revalidate();
   })();
  },
  [patchItemPhotos, state.inspection.id, state.currentSection, revalidator],
 );

 /* Task 9b — the OTHER items photos can be moved to: every item across the
  * inspection except the one currently being edited, each carrying its own
  * section id so the move resolves the right composite finding key on arrival. */
 const moveTargets = useMemo(
  () =>
   state.sections.flatMap((sec) =>
    (sec.items || []).map((it) => ({
     itemId: it.id,
     label: `${sec.title} › ${it.label || it.name || it.id}`,
     sectionId: sec.id,
    })),
   ),
  [state.sections],
 );

 /* Task 9b — bulk-move photos by index to a target item. Like bulk detach, the
  * strip emits indices DESC so each move keeps the remaining (lower) indices
  * valid; we POST highest-first too. The source section is the current one. */
 const onBulkMovePhotos = useCallback(
  (fromItemId: string, indices: number[], to: { itemId: string; sectionId?: string }) => {
   patchItemPhotos(fromItemId, (photos) => photos.filter((_, i) => !indices.includes(i)));
   const fromSectionId = state.currentSection?.id;
   (async () => {
    for (const idx of indices) {
     await fetch(`/api/inspections/${state.inspection.id}/items/${fromItemId}/photos/${idx}/move`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toItemId: to.itemId, toSectionId: to.sectionId, fromSectionId }),
     });
    }
    revalidator.revalidate();
   })();
  },
  [patchItemPhotos, state.inspection.id, state.currentSection, revalidator],
 );

 /* Task 8 — route a viewer per-photo action to the right mutation. */
 const onViewerAction = useCallback(
  (action: MediaAction, photo: GalleryPhoto) => {
   const itemId = photo.itemId;
   const idx = photo.photoIndex;
   const sectionId = state.currentSection?.id;
   if (!itemId || idx == null) return;
   // Plan 7 — video branch. A video entry exposes only poster · cover · caption
   // · delete (the MediaViewer toolbar enforces this). Poster opens the picker;
   // delete removes the Stream video + detaches the entry; cover/caption fall
   // through to the shared handlers (cover stores the poster image reference).
   if (photo.mediaType === "video" && photo.streamUid) {
    if (action === "poster") {
     setPosterTarget({
      streamUid: photo.streamUid,
      durationSec: photo.durationSec ?? 0,
      posterPct: photo.posterPct ?? 0,
     });
     return;
    }
    if (action === "delete") {
     patchItemPhotos(itemId, (photos) => photos.filter((_, i) => i !== idx));
     fetch(`/api/inspections/${state.inspection.id}/media/video/${encodeURIComponent(photo.streamUid)}`, {
      method: "DELETE",
      credentials: "include",
     }).then(() => revalidator.revalidate());
     return;
    }
    // cover / caption fall through to the photo handlers below (they address by
    // itemId + photoIndex, which is valid for video entries too).
   }
   if (action === "cover") {
    // Reuse the existing CoverCropper flow: crop-then-set on the displayed key.
    setGalleryCropSource({ key: photo.key, url: photo.url });
    return;
   }
   if (action === "annotate") {
    // Plan 4 sequential layering: annotate ON TOP of the crop. The annotate
    // base is croppedKey || originalKey — NEVER annotatedKey (that would
    // double-bake the existing annotation).
    const annotateBaseKey = photo.croppedKey || photo.originalKey || photo.key;
    setPhotoStudioUrl(`/api/inspections/${state.inspection.id}/photo?key=${encodeURIComponent(annotateBaseKey)}`);
    setPhotoStudioKey(photo.key);
    setPhotoStudioIndex(idx);
    setPhotoStudioTotal(0);
    setPhotoStudioOpen(true);
    return;
   }
   if (action === "crop") {
    // Plan 4: crop ALWAYS re-derives from the ORIGINAL photo (never the
    // cropped/annotated derivative). Open the PhotoCropper; the bake POSTs to
    // the new crop endpoint (or enqueues offline — Task 9). A re-crop that
    // would discard an existing annotation warns first.
    const originalKey = photo.originalKey || photo.key;
    setPhotoCropTarget({
     itemId,
     photoIndex: idx,
     sourceUrl: `/api/inspections/${state.inspection.id}/photo?key=${encodeURIComponent(originalKey)}`,
     hasAnnotation: !!photo.annotated,
     sectionId,
    });
    return;
   }
   if (action === "revert") {
    patchItemPhotos(itemId, (photos) => photos.map((p, i) => (i === idx ? { key: p.key } : p)));
    fetch(`/api/inspections/${state.inspection.id}/items/${itemId}/photos/${idx}/revert`, {
     method: "POST",
     credentials: "include",
     headers: { "Content-Type": "application/json" },
     body: JSON.stringify({ sectionId }),
    }).then(() => revalidator.revalidate());
    return;
   }
   if (action === "delete") {
    patchItemPhotos(itemId, (photos) => photos.filter((_, i) => i !== idx));
    fetch(`/api/inspections/${state.inspection.id}/items/${itemId}/photos/${idx}/detach`, {
     method: "POST",
     credentials: "include",
     headers: { "Content-Type": "application/json" },
     body: JSON.stringify({ sectionId }),
    }).then(() => revalidator.revalidate());
    return;
   }
   // rotate / caption — routed here but not yet implemented (not Plan 4).
   // TODO rotate/caption on item photos.
  },
  [patchItemPhotos, state.inspection.id, state.currentSection, revalidator],
 );

 /* Plan 4 (Task 8/9) — persist a baked crop for the targeted photo. When online,
  * POST multipart to the new crop endpoint; when offline, enqueue for replay
  * (Task 9). Either way, optimistically apply clearAnnotationOnRecrop locally so
  * the strip immediately reflects the new crop with any annotation cleared. */
 const performPhotoCropSave = useCallback(
  (target: { itemId: string; photoIndex: number; sectionId?: string }, blob: Blob, crop: PhotoCrop) => {
   const { itemId, photoIndex, sectionId } = target;
   const cropTransform = { aspect: crop.aspect, orientation: crop.orientation, ...crop.pixels };
   // Optimistic local apply: drop annotation, set crop. The croppedKey is not
   // yet known client-side; revalidate (online) / replay (offline) supplies it.
   patchItemPhotos(itemId, (photos) =>
    photos.map((p, i) =>
     i === photoIndex
      ? clearAnnotationOnRecrop(p, p.croppedKey ?? p.key, cropTransform)
      : p,
    ),
   );

   const nav = typeof navigator !== "undefined" ? navigator : undefined;
   if (shouldQueue(nav)) {
    // Plan 4 Q3 — offline: enqueue the baked crop; replay on reconnect.
    void getOfflineQueue().enqueueCrop({
     inspectionId: String(state.inspection.id),
     itemId,
     photoIndex,
     blob,
     crop: cropTransform,
     sectionId,
     enqueuedAt: Date.now(),
    });
    pushToast({ message: "Crop queued — will save when back online", durationMs: 3000 });
    return;
   }

   // Online: POST the bake directly to the crop endpoint.
   const fd = new FormData();
   fd.append("image", new File([blob], "cropped.jpg", { type: "image/jpeg" }));
   fd.append("crop", JSON.stringify(cropTransform));
   if (sectionId) fd.append("sectionId", sectionId);
   void (async () => {
    await fetch(
     `/api/inspections/${state.inspection.id}/items/${itemId}/photos/${photoIndex}/crop`,
     { method: "POST", credentials: "include", body: fd },
    );
    revalidator.revalidate();
   })();
  },
  [patchItemPhotos, state.inspection.id, revalidator],
 );

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
 <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true" aria-label="Add media">
  <button
   type="button"
   aria-label="Close"
   className="absolute inset-0 bg-[rgba(15,23,42,0.4)]"
   onClick={() => setAddMediaChooser(null)}
  />
  <div className="relative w-full max-w-md rounded-t-2xl bg-ih-bg-card p-4 shadow-ih-popover">
   <h2 className="mb-3 text-[15px] font-bold text-ih-fg-1">Add media</h2>
   <div className="grid grid-cols-2 gap-3">
    <button
     type="button"
     onClick={() => {
      setAddMediaChooser(null);
      photoInputRef.current?.click();
     }}
     className="min-h-[44px] rounded-xl border border-ih-border bg-ih-bg-muted px-4 py-3 text-[14px] font-bold text-ih-fg-1 hover:border-ih-primary"
    >
     Photo
    </button>
    {(() => {
     const offline = typeof navigator !== "undefined" && navigator.onLine === false;
     return (
      <button
       type="button"
       disabled={offline}
       onClick={() => {
        const t = addMediaChooser;
        setAddMediaChooser(null);
        setVideoCaptureTarget(t);
       }}
       title={offline ? "Video upload requires a connection" : undefined}
       className="min-h-[44px] rounded-xl border border-ih-border bg-ih-bg-muted px-4 py-3 text-[14px] font-bold text-ih-fg-1 hover:border-ih-primary disabled:opacity-40"
      >
       Video
       {offline && <span className="mt-1 block text-[10px] font-normal text-ih-fg-4">Requires a connection</span>}
      </button>
     );
    })()}
   </div>
  </div>
 </div>
 )}

 {/* Plan 7 — video capture + Cloudflare Stream direct-upload overlay. */}
 {videoCaptureTarget && (
 <VideoCapture
  inspectionId={String(state.inspection.id)}
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
 <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
 <div className="absolute inset-0 bg-[rgba(15,23,42,0.6)] backdrop-blur-sm" onClick={() => setRecropWarn(null)} />
 <div className="relative bg-ih-bg-card rounded-lg shadow-ih-popover p-6 max-w-sm w-full border border-ih-border">
 <h3 className="text-[15px] font-bold text-ih-fg-1">Re-crop this photo?</h3>
 <p className="text-[13px] text-ih-fg-3 mt-2">
 Re-cropping will remove the existing annotation on this photo (its marks are tied to the previous crop).
 </p>
 <div className="flex justify-end gap-2 mt-4">
 <button onClick={() => setRecropWarn(null)} className="px-4 py-2 text-[13px] font-bold text-ih-fg-2 hover:bg-ih-bg-muted rounded-md">Cancel</button>
 <button onClick={() => { const r = recropWarn.run; setRecropWarn(null); r(); }} className="px-4 py-2 text-[13px] font-bold text-white bg-ih-bad hover:bg-ih-bad/85 rounded-md">Crop &amp; clear</button>
 </div>
 </div>
 </div>
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
 <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
 <div
 className="absolute inset-0 bg-[rgba(15,23,42,0.6)] backdrop-blur-sm"
 onClick={cancelLeave}
 />
 <div className="relative bg-ih-bg-card rounded-lg shadow-ih-popover p-6 max-w-sm w-full">
 <h3 className="text-[15px] font-bold text-ih-fg-1">
 Unsaved changes
 </h3>
 <p className="text-[13px] text-ih-fg-3 mt-2">
 You have unsaved changes. Are you sure you want to leave?
 </p>
 <div className="flex justify-end gap-2 mt-4">
 <button
 onClick={cancelLeave}
 className="px-4 py-2 text-[13px] font-bold text-ih-fg-2 hover:bg-ih-bg-muted rounded-md"
 >
 Stay
 </button>
 <button
 onClick={confirmLeave}
 className="px-4 py-2 text-[13px] font-bold text-white bg-ih-bad hover:bg-ih-bad/85 rounded-md"
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
 <div className="absolute inset-0 bg-[rgba(15,23,42,0.6)] backdrop-blur-sm" onClick={() => { setPublishError(null); state.setShowPublishModal(false); }} />
 <div className="relative bg-ih-bg-card rounded-xl shadow-ih-popover p-6 max-w-md w-full border border-ih-border">
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
 {publishError && (
 <div role="alert" className="mt-4 p-3 rounded-lg bg-ih-bad/10 border border-ih-bad/30 text-[12px] text-ih-bad font-medium">
 {publishError}
 </div>
 )}
 <div className="flex justify-end gap-2 mt-5">
 <button onClick={() => { setPublishError(null); state.setShowPublishModal(false); }} className="px-4 py-2 text-[13px] font-bold text-ih-fg-3 hover:bg-ih-bg-muted rounded-md">Cancel</button>
 <button
 disabled={publishFetcher.state !== "idle"}
 onClick={() => {
 // Keep the modal open: the publish-result effect closes it on success
 // and shows the real server reason inline on failure.
 setPublishError(null);
 publishFetcher.submit({ intent: "publish" }, { method: "post" });
 }}
 className="px-4 py-2 text-[13px] font-bold text-white bg-ih-ok hover:bg-ih-ok/85 rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
 >{publishFetcher.state !== "idle" ? "Publishing…" : "Publish Now"}</button>
 </div>
 </div>
 </div>
 )}

 {/* Inspector sign modal */}
 {signModalOpen && (
 <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
 <div className="absolute inset-0 bg-[rgba(15,23,42,0.6)] backdrop-blur-sm" onClick={() => setSignModalOpen(false)} />
 <div className="relative bg-ih-bg-card rounded-xl shadow-ih-popover p-6 max-w-md w-full border border-ih-border">
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
 <p className="text-sm text-ih-bad-fg mt-2">Failed to save signature. Please try again.</p>
 )}
 </div>
 </div>
 )}

 {/* Comment library drawer */}
 {state.showCommentLibrary && (
 <div className="fixed inset-0 z-[80] flex">
 <div
 className="absolute inset-0 bg-[rgba(15,23,42,0.4)] backdrop-blur-sm"
 onClick={() => state.setShowCommentLibrary(false)}
 />
 <div className="relative ml-auto w-full max-w-md bg-ih-bg-card border-l border-ih-border shadow-ih-popover flex flex-col h-full">
 <div className="flex items-center justify-between px-4 py-3 border-b border-ih-border">
 <h3 className="text-[14px] font-bold">Comment Library</h3>
 <button
 onClick={() => state.setShowCommentLibrary(false)}
 className="text-ih-fg-4 hover:text-ih-fg-2 text-lg"
 >
 &#x2715;
 </button>
 </div>

 {/* Sort + Filter mode header */}
 <div className="flex items-center gap-3 px-3 py-2 border-b border-ih-border">
 <div className="flex items-center gap-1.5">
 <span className="text-[10px] uppercase tracking-[0.1em] text-ih-fg-4">Filter</span>
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
 <span className="text-[10px] uppercase tracking-[0.1em] text-ih-fg-4">Sort</span>
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
 <span className="text-ih-fg-4">Context:</span>
 <span>
 {state.currentSection?.title} › {(state.activeItem.label || state.activeItem.name) as string}
 </span>
 {Boolean(state.activeItemId && state.getResult(state.activeItemId)?.rating) && (
 <>
 <span className="text-ih-fg-4">·</span>
 <span>
 {state.getRatingLabel?.(state.getResult(state.activeItemId as string)?.rating as string) ?? ''}
 </span>
 </>
 )}
 <button
 onClick={() => comments.setFilterMode('all')}
 className="ml-auto text-ih-fg-4 hover:text-ih-fg-2"
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
 ? "bg-ih-primary-tint text-ih-primary"
 : "text-ih-fg-4 hover:text-ih-fg-2"
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
 <p className="text-[10px] text-ih-fg-4 mt-1">
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
 ? "bg-ih-primary-tint ring-1 ring-inset ring-ih-primary/30"
 : ""
 }`}
 >
 <div className="flex items-start gap-2 p-2.5 hover:bg-ih-bg-muted">
 <p className="flex-1 text-[12px] text-ih-fg-2 leading-relaxed">
 {c.text}
 </p>
 <span className="text-[10px] text-ih-fg-4 tabular-nums whitespace-nowrap">
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
 <div className="absolute inset-0 bg-[rgba(15,23,42,0.4)] backdrop-blur-sm" onClick={() => state.closeSectionPicker()} />
 <div className="relative w-full max-w-md bg-ih-bg-card rounded-xl shadow-ih-popover border border-ih-border overflow-hidden">
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
  <div className="absolute inset-0 bg-[rgba(15,23,42,0.4)] backdrop-blur-sm" onClick={() => setTagPickerOpen(false)} />
  <div className="relative w-full max-w-sm bg-ih-bg-card rounded-xl shadow-ih-popover border border-ih-border overflow-hidden">
  <div className="px-4 py-3 border-b border-ih-border flex items-center justify-between">
   <h3 className="text-[14px] font-bold text-ih-fg-1">Tags</h3>
   <button
   onClick={() => setTagPickerOpen(false)}
   className="text-ih-fg-4 hover:text-ih-fg-2 text-lg"
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
     : "hover:bg-ih-bg-muted"
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
 <div className="fixed top-0 left-0 right-0 z-50">
 <div className="h-14 bg-ih-bg-card border-b border-ih-border flex items-center px-4 gap-3">
 <a
 href="/dashboard"
 className="w-9 h-9 rounded-md flex items-center justify-center text-ih-fg-3 hover:bg-ih-bg-muted"
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
 <div className="hidden lg:flex items-center gap-0.5 bg-ih-bg-muted rounded-md p-0.5">
 <button
 onClick={() => state.setViewMode("split")}
 className={`px-2 py-1 rounded text-[11px] font-bold ${state.viewMode === "split" ? "bg-ih-bg-card text-ih-fg-1 shadow-ih-card" : "text-ih-fg-3"}`}
 title="Split view (Cmd+1)"
 >Split</button>
 <button
 onClick={() => state.setViewMode("focus")}
 className={`px-2 py-1 rounded text-[11px] font-bold ${state.viewMode === "focus" ? "bg-ih-bg-card text-ih-fg-1 shadow-ih-card" : "text-ih-fg-3"}`}
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
  ? "bg-ih-primary-tint text-ih-primary"
  : "text-ih-fg-3 hover:bg-ih-bg-muted"
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
 <span className="w-1.5 h-1.5 rounded-full bg-ih-watch animate-pulse" />
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
 <span className="w-1.5 h-1.5 rounded-full bg-ih-bad" />
 Error
 </>
 )}
 </span>
 )}

 {/* Status badge */}
 <span className="px-2 h-7 rounded-md text-[11px] font-bold uppercase tracking-wide ring-1 ring-inset bg-ih-bg-muted text-ih-fg-2 ring-ih-border inline-flex items-center">
 {state.inspection.status as string}
 </span>

 {/* Theme cycle: light → dark → field (Track H 迁移⑤) → auto */}
 <button
 onClick={() => setColorScheme(scheme === 'light' ? 'dark' : scheme === 'dark' ? 'field' : scheme === 'field' ? 'auto' : 'light')}
 className="w-9 h-9 rounded-md flex items-center justify-center text-ih-fg-3 hover:bg-ih-bg-muted"
 title={`Theme: ${scheme}${scheme === 'field' ? ' (high-contrast outdoor)' : ''}`}
 >
 {scheme === 'dark' ? (
 <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>
 ) : scheme === 'light' ? (
 <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
 ) : scheme === 'field' ? (
 <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364-.707-.707M6.343 6.343l-.707-.707m12.728 0-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /></svg>
 ) : (
 <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
 )}
 </button>

 {/* Settings button */}
 <button
 onClick={() => state.setSettingsOpen(true)}
 className="w-9 h-9 rounded-md flex items-center justify-center text-ih-fg-3 hover:bg-ih-bg-muted"
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
 className="h-3.5 w-3.5 rounded border-ih-border-strong text-ih-primary"
 />
 Auto-sign
 </label>

 {/* Preview full report — opens the whole report (all sections) in a new tab.
     Owner preview works on drafts (tokenless via the report-view loader). */}
 {loaderData.tenantSlug && (
 <button
 onClick={() => window.open(`/report-view/${loaderData.tenantSlug}/${state.inspection.id}`, "_blank", "noopener")}
 className="hidden lg:inline-flex h-9 px-3 rounded-md border border-ih-border text-[12px] font-bold text-ih-fg-2 hover:bg-ih-bg-muted items-center gap-1.5"
 title="Preview the full report (all sections) in a new tab"
 >
 <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
 </svg>
 Preview
 </button>
 )}

 {/* Preview PDF — opens the real server-rendered PDF deliverable (the exact
     client deliverable) in a new tab. Owner on-demand render works pre-publish
     on drafts via the owner/JWT-authed /api/inspections/:id/pdf endpoint. */}
 <button
 onClick={() => window.open(`/api/inspections/${state.inspection.id}/pdf?type=full`, "_blank", "noopener")}
 className="hidden lg:inline-flex h-9 px-3 rounded-md border border-ih-border text-[12px] font-bold text-ih-fg-2 hover:bg-ih-bg-muted items-center gap-1.5"
 title="Preview the real server-rendered PDF (the exact client deliverable) in a new tab"
 >
 <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
 </svg>
 Preview PDF
 </button>

 {/* Sign now button */}
 <button
 onClick={() => setSignModalOpen(true)}
 className="hidden lg:inline-flex h-9 px-3 rounded-md border border-ih-border text-[12px] font-bold text-ih-fg-2 hover:bg-ih-bg-muted items-center gap-1.5"
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
 className="h-9 px-4 rounded-md bg-ih-ok text-white font-bold text-[12px] hover:bg-ih-ok/85 transition-colors inline-flex items-center gap-1.5"
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
