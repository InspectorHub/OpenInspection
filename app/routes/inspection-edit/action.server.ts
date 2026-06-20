import type { Route } from "../+types/inspection-edit";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { sanitizeSettingsPatch } from "~/lib/settings-patch";

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
