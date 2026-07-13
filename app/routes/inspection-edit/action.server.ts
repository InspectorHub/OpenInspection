import type { Route } from "../+types/inspection-edit";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { sanitizeSettingsPatch } from "~/lib/settings-patch";
import { unwrapResultsResponse } from "~/lib/results";
import { mapPool } from "~/lib/map-pool";

export async function action({ request, params, context }: Route.ActionArgs) {
 const token = await requireToken(context, request);
 const formData = await request.formData();
 const intent = formData.get("intent");
 const api = createApi(context, { token });
 // B-17: every branch must record whether the API write actually landed —
 // returning { ok: true } unconditionally turned failed PATCHes into silent
 // data loss (the save pill said "Saved" either way).
 let ok = true;

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

 // Commercial PCA Phase S — narrative editor panel saves one block per blur.
 // Rides the BFF relay like every other mutation (no raw client fetch to
 // /api/... — see feedback_core_bff_no_client_fetch): the route action holds
 // the authed tenant context and calls the same service method the Task 9
 // /api/inspections/:id/pca-narrative endpoint uses.
 if (intent === "save-pca-narrative") {
 const key = String(formData.get("key") ?? "");
 const value = String(formData.get("value") ?? "");
 if (!key) return { ok: false as const, intent: "save-pca-narrative" };
 const res = await api.inspections[":id"]["pca-narrative"].$patch({
 param: { id: params.id },
 json: { [key]: value },
 });
 return { ok: res.ok, intent: "save-pca-narrative" };
 }

 // Commercial PCA Phase T — the commercial subtype + report tier selectors
 // (CommercialReportControls) persist through the real property-facts PATCH
 // like every other mutation (no raw client fetch — see
 // feedback_core_bff_no_client_fetch). Reuses the same
 // /api/inspections/:id/property-facts endpoint. PropertyInfoForm's fields are
 // validated against PropertyFactsWriteSchema (strip keys + the commercial
 // subtype-preset `metadata` envelope); the whole payload is relayed as-is.
 if (intent === "save-property-facts") {
 const payload = JSON.parse(String(formData.get("payload") ?? "{}"));
 const res = await api.inspections[":id"]["property-facts"].$patch({
 param: { id: params.id },
 json: payload,
 });
 return { ok: res.ok, intent: "save-property-facts" };
 }

 // Commercial PCA Phase U (Batch C2b) — per-unit editor mutations + lazy scope
 // read. All ride the BFF relay (no bare client fetch to /api/...): the action
 // holds the authed tenant context that the unit routes' requireRole guard
 // needs. The editor watches this fetcher and revalidates the loader on success
 // so the scope switcher / units manager / progress dots refresh.
 if (intent === "unit-create") {
 const name = String(formData.get("name") ?? "").trim();
 if (!name) return { ok: false as const, intent: "unit-create" };
 const res = await api.inspections[":id"].units.$post({
 param: { id: params.id },
 json: { parentUnitId: null, kind: "unit", type: "unit", name },
 });
 return { ok: res.ok, intent: "unit-create" };
 }

 if (intent === "unit-rename") {
 const unitId = String(formData.get("unitId") ?? "");
 const name = String(formData.get("name") ?? "").trim();
 if (!unitId || !name) return { ok: false as const, intent: "unit-rename" };
 const res = await api.inspections[":id"].units[":unitId"].$patch({
 param: { id: params.id, unitId },
 json: { name },
 });
 return { ok: res.ok, intent: "unit-rename" };
 }

 if (intent === "unit-delete") {
 const unitId = String(formData.get("unitId") ?? "");
 if (!unitId) return { ok: false as const, intent: "unit-delete" };
 const res = await api.inspections[":id"].units[":unitId"].$delete({
 param: { id: params.id, unitId },
 });
 return { ok: res.ok, intent: "unit-delete" };
 }

 if (intent === "unit-duplicate") {
 const unitId = String(formData.get("unitId") ?? "");
 if (!unitId) return { ok: false as const, intent: "unit-duplicate" };
 const res = await api.inspections[":id"].units[":unitId"].duplicate.$post({
 param: { id: params.id, unitId },
 });
 return { ok: res.ok, intent: "unit-duplicate" };
 }

 if (intent === "unit-bulk-create") {
 // The panel forwards the whole discriminated-union body as JSON so a single
 // relay covers both floors_stacks and csv modes.
 const payload = JSON.parse(String(formData.get("payload") ?? "{}"));
 const res = await api.inspections[":id"].units.bulk.$post({
 param: { id: params.id },
 json: payload,
 });
 return { ok: res.ok, intent: "unit-bulk-create" };
 }

 if (intent === "unit-mode-switch") {
 const mode = formData.get("mode") === "per_unit" ? ("per_unit" as const) : ("tagged" as const);
 const res = await api.inspections[":id"]["unit-mode"].$post({
 param: { id: params.id },
 json: { mode },
 });
 return { ok: res.ok, intent: "unit-mode-switch" };
 }

 if (intent === "load-scope") {
 // Lazy per-unit results slice — the loader only fetches the '_default'
 // common scope on first paint; a scope switch pulls the selected unit's
 // findings on demand (only when the collab doc has not already synced the
 // full map). Returns the composite-keyed slice for the editor to merge.
 const scope = String(formData.get("scope") ?? "");
 if (!scope) return { ok: false as const, intent: "load-scope" };
 const res = await api.inspections[":id"].results.$get({
 param: { id: params.id },
 query: { scope },
 });
 if (!res.ok) return { ok: false as const, intent: "load-scope", scope };
 const body = await res.json();
 return { ok: true as const, intent: "load-scope", scope, results: unwrapResultsResponse(body) };
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

 // D8 — structural-edit pipeline: persist the next snapshot + optionally
 // converge the DO so live collab clients resync.
 // NOTE the two calls below sit behind DIFFERENT authorization surfaces: the
 // template-snapshot PATCH is tenant-role gated (owner/manager/inspector),
 // while collab/restructure is assignment-scoped (canAccessInspectionCollab).
 // They cannot diverge in the common case (the editor only loads for an
 // authorized user), but if the collab ping is refused we must NOT report a
 // clean convergence over a drifted doc — see the status check below.
 if (intent === "restructure") {
  const id = params.id;
  const snapshot = JSON.parse(String(formData.get("snapshot") ?? "{}"));
  await api.inspections[":id"]["template-snapshot"].$patch({ param: { id }, json: { snapshot } });
  if (formData.get("collab") === "1") {
   try {
    const res = await api.inspections[":id"].collab.restructure.$post({ param: { id } });
    // 501 = DO binding absent / collab off — tolerated (single-client
    // fallback; revalidation still refreshes this editor). Any OTHER non-ok
    // (e.g. 403 when this user isn't authorized for collab on this
    // inspection) means D1 changed but the live DO did NOT converge: surface
    // it instead of presenting a converged-looking UI over a drifted doc.
    if (!res.ok && res.status !== 501) {
     return {
      ok: false as const,
      intent: "restructure",
      error: "Structure saved, but live sync did not converge. Reload to continue editing.",
     };
    }
   } catch {
    // network / binding exception — revalidation still refreshes editor state.
   }
  }
  return { ok: true as const, intent: "restructure" };
 }

 // D8 — save the inspection's current structure back to its source template,
 // or fork it into a new template. Reuses the existing template service.
 if (intent === "save-structure-template") {
  const snapshot = JSON.parse(String(formData.get("snapshot") ?? "{}"));
  const mode = formData.get("mode") === "new" ? "new" : "back";
  if (mode === "new") {
   const name = String(formData.get("name") ?? "").trim() || "Custom Template";
   const res = await api.inspections.templates.$post({ json: { name, schema: snapshot } });
   return { ok: res.ok, intent: "save-structure-template" };
  }
  // mode === "back" — update the source template in place (PUT needs its name).
  const templateId = String(formData.get("templateId") ?? "");
  if (!templateId) return { ok: false as const, intent: "save-structure-template", error: "No source template" };
  // Fetch the source name for the PUT. If we cannot resolve it, FAIL the save
  // rather than PUT a placeholder name — silently renaming the source template
  // would be a surprising, hard-to-undo side effect.
  const tplRes = await api.inspections.templates[":id"].$get({ param: { id: templateId } });
  if (!tplRes.ok) {
   return { ok: false as const, intent: "save-structure-template", error: "Could not load the source template to update it." };
  }
  const tb = (await tplRes.json()) as { data?: { name?: string } };
  const name = tb.data?.name?.trim();
  if (!name) {
   return { ok: false as const, intent: "save-structure-template", error: "The source template has no name." };
  }
  const res = await api.inspections.templates[":id"].$put({ param: { id: templateId }, json: { name, schema: snapshot } });
  return { ok: res.ok, intent: "save-structure-template" };
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

 // Commercial PCA Phase M Task 10 — Compliance panel mutations. All ride the
 // BFF relay (no raw client fetch to /api/...) through the Task 6 compliance
 // API. Mirrors the save-pca-narrative / save-property-facts shape: relay
 // through createApi, return { ok: res.ok, intent }.
 if (intent === "compliance-signoff") {
  const role = String(formData.get("role") ?? "");
  const personId = String(formData.get("personId") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const license = String(formData.get("license") ?? "").trim() || null;
  const dualRole = formData.get("dualRole") === "true";
  if ((role !== "field_observer" && role !== "pcr_reviewer") || !personId || !name) {
   return { ok: false as const, intent: "compliance-signoff" };
  }
  const res = await api.inspections[":id"].compliance.signoff.$post({
   param: { id: params.id },
   json: { role, personId, name, license, dualRole },
  });
  return { ok: res.ok, intent: "compliance-signoff", role };
 }

 if (intent === "compliance-remove-signoff") {
  const role = String(formData.get("role") ?? "");
  if (role !== "field_observer" && role !== "pcr_reviewer") {
   return { ok: false as const, intent: "compliance-remove-signoff" };
  }
  const res = await api.inspections[":id"].compliance.signoff[":role"].$delete({
   param: { id: params.id, role },
  });
  return { ok: res.ok, intent: "compliance-remove-signoff", role };
 }

 if (intent === "compliance-doc-review-seed") {
  // Not one of the Task 10 brief's five listed intents, but required so the
  // checklist is reachable at all — nothing else in the app calls
  // seedDocumentReview, so an inspector with an empty checklist would
  // otherwise have no way to populate it.
  const res = await api.inspections[":id"].compliance["doc-review"].seed.$post({
   param: { id: params.id },
  });
  return { ok: res.ok, intent: "compliance-doc-review-seed" };
 }

 if (intent === "compliance-doc-review") {
  const documentKey = String(formData.get("documentKey") ?? "");
  if (!documentKey) return { ok: false as const, intent: "compliance-doc-review" };
  const res = await api.inspections[":id"].compliance["doc-review"][":documentKey"].$patch({
   param: { id: params.id, documentKey },
   json: {
    requested: formData.get("requested") === "true",
    received: formData.get("received") === "true",
    reviewed: formData.get("reviewed") === "true",
    na: formData.get("na") === "true",
    notes: String(formData.get("notes") ?? "") || null,
   },
  });
  return { ok: res.ok, intent: "compliance-doc-review", documentKey };
 }

 if (intent === "compliance-psq") {
  let responses: Record<string, unknown> = {};
  try {
   responses = JSON.parse(String(formData.get("responses") ?? "{}"));
  } catch {
   /* malformed payload — send the empty object rather than throwing */
  }
  const res = await api.inspections[":id"].compliance.psq.$put({
   param: { id: params.id },
   json: { responses },
  });
  return { ok: res.ok, intent: "compliance-psq" };
 }

 if (intent === "compliance-psq-status") {
  const status = String(formData.get("status") ?? "");
  if (status !== "sent" && status !== "received" && status !== "declined") {
   return { ok: false as const, intent: "compliance-psq-status" };
  }
  const reason = formData.get("reason");
  const res = await api.inspections[":id"].compliance.psq.status.$post({
   param: { id: params.id },
   json: { status, ...(reason ? { reason: String(reason) } : {}) },
  });
  return { ok: res.ok, intent: "compliance-psq-status", status };
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
 // Task 15: fan out per-file uploads with bounded concurrency instead of
 // awaiting them one at a time — burst-camera submissions of a dozen+
 // files no longer serialize behind each other's upload round trip. The
 // concurrency cap bounds R2-write / isolate-memory pressure on this
 // Worker, not the total subrequest count for the submission (the client
 // is responsible for chunking very large batches to stay under the
 // Worker subrequest cap).
 const CONCURRENCY = 4;
 type UploadResult = { index: number; ok: boolean; key?: string; error?: string };
 const results: UploadResult[] = await mapPool(files, CONCURRENCY, async (file, index) => {
 try {
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
 return j.data?.key ? { index, ok: true, key: j.data.key } : { index, ok: false, error: "NO_KEY" };
 }
 return { index, ok: false, error: `HTTP_${res.status}` };
 } catch {
 return { index, ok: false, error: "EXCEPTION" };
 }
 });
 // keys[] preserves the pre-existing contract: successful upload keys in
 // input order — downstream consumers (the client effect that attaches
 // photos to the store) only ever read this array.
 const keys = results.filter((r) => r.ok).map((r) => r.key!);
 ok = files.length > 0 && Boolean(itemId) && results.every((r) => r.ok);
 // results[] is new: per-file status so a future client can surface which
 // specific file(s) in a burst failed instead of an all-or-nothing toast.
 return { ok, keys, results, itemId, targetType, customId, defectKind };
 }

 return { ok };
}
