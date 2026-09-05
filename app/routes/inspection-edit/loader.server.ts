import type { Route } from "../+types/inspection-edit";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { unwrapResultsResponse } from "~/lib/results";
import type { RatingLevel, ResultMap } from "~/hooks/useInspection";
import { resolvePcaNarrative } from "../../../server/lib/pca-narrative";
import { RELIANCE_TEMPLATES } from "../../../server/lib/pca-reliance-text";
import { METADATA_PRESETS, type PropertyMetaField } from "../../../server/lib/commercial-subtypes";
import type { CompliancePanelData } from "~/components/inspection-edit/CompliancePanel";
import { getCloudflareEnv } from "~/lib/load-context";
import { revisionStatusForInspection } from "../../../server/lib/statutory/revision-status";

export async function loader({ request, params, context }: Route.LoaderArgs) {
 const token = await requireToken(context, request);
 const id = params.id;

 const api = createApi(context, { token });
 const [inspRes, resultsRes, reportRes, tagsRes, sessRes, defectCatRes, unitsRes, unitProgressRes, complianceRes, statutoryDetailsRes, statutoryCoverageRes] = await Promise.all([
 api.inspections[":id"].$get({ param: { id } }),
 // Commercial PCA Phase U (Batch C-lazy) — first paint only needs the common
 // scope. The editor opens at activeUnitId = null (the '_default' scope), so
 // we fetch just that slice: for a `tagged` inspection '_default' IS the whole
 // map (no payload change); for a `per_unit` inspection this drops every unit's
 // findings from first paint — they load on demand when a unit is selected
 // (Batch C2, not this batch). The optional `scope` query flows through
 // hono/client once the route declares it.
 api.inspections[":id"].results.$get({ param: { id }, query: { scope: '_default' } }),
 api.inspections[":id"]["report-data"].$get({ param: { id } }),
 // Track H (C-12): tag library moved off the client-side fetch into the loader.
 api.tags.index.$get().catch(() => null),
 // tenantSlug for the "Preview full report" link (/report-view/:slug/:id).
 api.sessionContext.context.$get().catch(() => null),
 // Authoring unification Plan-4 module K — the tenant's defect categories,
 // fetched ONCE here (seeded on first read) so the editor can build a single
 // name/id → color lookup and thread it into every canned-defect chip,
 // instead of resolving color per-defect.
 api.defectCategories["defect-categories"].$get().catch(() => null),
 // Commercial PCA Phase U (Batch C2b) — the inspection's unit rows (scope
 // switcher + units manager) and the server-computed per-unit progress
 // summary (completion dots). Both default to empty when absent (residential
 // inspections with no units render exactly as today). Tolerant .catch so a
 // per-unit endpoint hiccup never 500s the whole editor.
 api.inspections[":id"].units.$get({ param: { id } }).catch(() => null),
 api.inspections[":id"]["unit-progress"].$get({ param: { id } }).catch(() => null),
 // Commercial PCA Phase M Task 10 — sign-off/PSQ/doc-review/conformance for
 // the CompliancePanel. Fetched unconditionally (cheap, same shape as
 // units/unit-progress above) even though the panel only renders at
 // reportTier === 'full_pca' — mirrors the existing loader convention of not
 // conditioning the parallel fetch list on client-only gates.
 api.inspections[":id"].compliance.$get({ param: { id } }).catch(() => null),
 // The inspection-level answers a statutory form asks for. This endpoint 404s
 // for every ordinary inspection — that is its ANSWER, not a failure — so the
 // null it leaves behind is what decides whether the panel renders at all.
 api.inspections[":id"]["statutory-details"].$get({ param: { id } }).catch(() => null),
 // Which required boxes are still empty. Fetched HERE rather than on demand
 // because the whole point is that an inspector sees it without asking: the
 // information existed all along and only ever arrived after publish.
 // A failure leaves null, which renders as no panel rather than as "nothing is
 // missing" — see the type's own note.
 api.inspections[":id"]["statutory-form"].coverage.$get({ param: { id } }).catch(() => null),
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
 // The base structure MUST come from the inspection's OWN templateSnapshot
 // column — that's where inline structure edits (add/rename/delete/move) are
 // PATCHed, and it's the exact source getReportData reads for the display. The
 // top-level `data.templateSnapshot` is not set by the inspection GET, so the
 // old fallback resolved to `template.schema` (the pristine SOURCE template),
 // which never tracks per-inspection edits — every structural op then rebuilt
 // from the original template and silently dropped prior edits. Prefer the
 // per-inspection column; fall back to the source template only for legacy
 // inspections that pre-date the snapshot column.
 // (May arrive as a JSON string — parsed below.)
 const rawSchema = (data?.inspection as Record<string, unknown>)?.templateSnapshot ||
 data?.templateSnapshot ||
 (data?.template as Record<string, unknown>)?.schema;
 const schema = ((typeof rawSchema === "string"
 ? JSON.parse(rawSchema)
 : rawSchema) as {
 sections: Array<Record<string, unknown>>;
 }) || { sections: [] };

 // The snapshot's own item attributes, captured BEFORE the overlay below
 // replaces `schema.sections` wholesale.
 //
 // report-data's projection drops `attributes` ON PURPOSE — a DECLARED skip in
 // `scripts/check-item-key-parity.mjs` ("projected separately by the attributes
 // resolver"), and the report genuinely does not need them. The EDITOR does:
 // `ItemEditor` only renders `ItemAttributesPanel` when `item.attributes` is a
 // non-empty array, so replacing the sections with the projection turned the
 // panel off everywhere while the panel, its handler and `onItemAttribute` were
 // all built and wired. Nothing failed; the control simply was not there.
 //
 // Measured 2026-08-30 across the seed templates: 47 statutory bindings read
 // `item_attribute` — TREC 23, FL Citizens roof 24 — and not one of them could
 // be answered. `residential.json` carries a further 21 attribute definitions
 // that no inspector could reach either, so this was never only a statutory
 // problem. The fix merges the snapshot BACK; the projection is left alone.
 const snapshotAttributes = new Map<string, unknown[]>();
 // `description` is the SECOND key the projection drops, and it is dropped for
 // the same declared reason. On a statutory template it carries the
 // authority's own instruction — the Citizens roof items print "(check all
 // that apply and explain below)" and the warning that the roof column's rules
 // are 41.5pt wide, and FL OIR-B1-1802's one `fieldInstructions` is the
 // retrofit paragraph an inspector has to read verbatim. `ItemEditor` renders
 // it whenever it is present, so carrying it costs nothing and NOT carrying it
 // means text that is stored where nobody can see it, which is worse than text
 // that was never written.
 const snapshotDescriptions = new Map<string, string>();
 for (const sec of (schema.sections ?? [])) {
 for (const item of ((sec.items ?? []) as Array<Record<string, unknown>>)) {
  const attrs = item.attributes;
  if (typeof item.id === "string" && Array.isArray(attrs) && attrs.length > 0) {
  snapshotAttributes.set(item.id, attrs);
  }
  const description = item.description;
  if (typeof item.id === "string" && typeof description === "string" && description !== "") {
  snapshotDescriptions.set(item.id, description);
  }
 }
 }

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
 // Only when the projection carried none: should report-data ever start
 // projecting them, its value is the newer one and wins.
 if (it.attributes === undefined && typeof it.id === "string") {
 const attrs = snapshotAttributes.get(it.id);
 if (attrs) it.attributes = attrs;
 }
 // Merged the same way and under the same condition, so should report-data
 // ever start projecting descriptions its value is the newer one and wins.
 if (it.description === undefined && typeof it.id === "string") {
 const description = snapshotDescriptions.get(it.id);
 if (description) it.description = description;
 }
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
 // The `inspection_results` row id, read straight off the envelope rather than
 // through `unwrapResultsResponse` — that helper's whole job is to return the
 // MAP across three historical shapes, and widening it to also carry a sibling
 // field would put the two on one return value where only one of them has the
 // legacy-shape problem.
 //
 // It is what an `ai_content_reviews` row cites (#61). Null on legacy
 // inspections created before every inspection got a results row; the review
 // surface fails closed there rather than recording against a guessed id.
 const resultId = ((resultsBody as { data?: { resultId?: string | null } }).data?.resultId) ?? null;

 let tagLibrary: Array<{ id: string; name: string; color: string }> = [];
 if (tagsRes?.ok) {
 const tagsBody = await tagsRes.json() as { data?: Array<{ id: string; name: string; color: string }> };
 tagLibrary = tagsBody.data ?? [];
 }

 let tenantSlug: string | null = null;
 let videoProvider: "r2" | "stream" = "r2";
 let collabEditing = false;
 if (sessRes?.ok) {
 const sb = await sessRes.json() as {
  data?: {
   branding?: { tenantSlug?: string | null };
   videoProvider?: "r2" | "stream";
   collabEditing?: boolean;
  };
 };
 tenantSlug = sb.data?.branding?.tenantSlug ?? null;
 // Plan 7 — resolved video backend provider for this tenant (default 'r2').
 // Drives VideoCapture/VideoPlayer branch selection in the editor.
 videoProvider = sb.data?.videoProvider ?? "r2";
 // #181 — per-tenant collab editing flag (default false until collab is GA).
 collabEditing = sb.data?.collabEditing ?? false;
 }

 // Plan 7 — the Stream customer subdomain (env) drives video poster thumbnails
 // + the player iframe. Absent ⇒ null; the viewer/strip fail closed gracefully
 // (no fabricated subdomain).
 const streamCustomerSubdomain = getCloudflareEnv(context).STREAM_CUSTOMER_SUBDOMAIN ?? null;

 // D8 — expose the RAW (un-normalized) snapshot so structural ops (addSection /
 // duplicateSection / deleteSection / moveSection) can operate on a clean
 // TemplateSchemaV2 object. The `schema` field above is NORMALIZED (overlaid
 // with report-data) and must NOT be PATCHed to the template-snapshot endpoint.
 const templateSnapshot = ((typeof rawSchema === 'string' ? JSON.parse(rawSchema) : rawSchema) ?? { schemaVersion: 2, sections: [] }) as { schemaVersion: 2; sections: unknown[] };

 // Which revision of the authority's form governs this inspection, decided
 // HERE and never in the browser. It is a comparison of date windows, and a
 // second implementation of it on the client would disagree with this one at
 // some boundary -- which is the one kind of disagreement nobody notices,
 // because nobody checks a date boundary by hand. `null` for every ordinary
 // inspection, and for a statutory template that names no revision.
 const revisionStatus = revisionStatusForInspection({
 snapshot: templateSnapshot,
 inspectionDate: String((inspection as { date?: unknown }).date ?? "").slice(0, 10),
 now: Date.now(),
 });

 // Commercial PCA Phase S — seed-resolved narrative for the editor panel.
 const pcaNarrative = resolvePcaNarrative((inspection as { pcaNarrative?: unknown }).pcaNarrative);

 // Authoring unification Plan-4 module K — tenant defect categories (id/name/color).
 let defectCategories: Array<{ id: string; name: string; color: string }> = [];
 if (defectCatRes?.ok) {
 const defectCatBody = await defectCatRes.json() as { data?: Array<{ id: string; name: string; color: string }> };
 defectCategories = defectCatBody.data ?? [];
 }

 // Commercial PCA Phase U (Batch C2b) — unit rows + per-unit progress.
 type UnitRow = {
   id: string; name: string; kind: string; type: string;
   parentUnitId: string | null; sortOrder: number;
 };
 let units: UnitRow[] = [];
 if (unitsRes?.ok) {
   const unitsBody = await unitsRes.json() as { data?: { units?: UnitRow[] } };
   units = unitsBody.data?.units ?? [];
 }

 type UnitProgressSummary = {
   units: Array<{ unitId: string; rated: number; total: number }>;
   commonRated: number;
   total: number;
 };
 let unitProgress: UnitProgressSummary = { units: [], commonRated: 0, total: 0 };
 if (unitProgressRes?.ok) {
   const upBody = await unitProgressRes.json() as { data?: UnitProgressSummary };
   if (upBody.data) unitProgress = upBody.data;
 }

 // `unit_inspection_mode` rides along on the inspection row (getInspection
 // spreads the full row); it is not in the hand-written narrow type, so read it
 // defensively. Default 'tagged' → the editor looks exactly as today.
 const unitInspectionMode =
   (inspection as { unitInspectionMode?: "tagged" | "per_unit" }).unitInspectionMode === "per_unit"
     ? "per_unit" as const
     : "tagged" as const;

 // Commercial PCA Phase M Task 10 — compliance artifacts for the
 // CompliancePanel. Defaults to the empty/non-conformant shape when the fetch
 // fails or the inspection has no compliance rows yet (new full_pca reports).
 let compliance: Omit<CompliancePanelData, "relianceText"> = {
   reportSignoffs: [],
   psq: null,
   documentReview: [],
   conformance: { standard: "E2018-24", conforms: false },
 };
 if (complianceRes?.ok) {
   const complianceBody = await complianceRes.json() as { data?: Omit<CompliancePanelData, "relianceText"> };
   if (complianceBody.data) compliance = complianceBody.data;
 }

 // Mirrors inspection-report.service.ts's own relianceText resolution
 // (Phase M): Phase S's pca_narrative JSON blob may carry inspector-edited
 // userReliance/pointInTime/siteSpecific text under those keys; fall back to
 // the seeded ASTM boilerplate per-field. Read directly off the raw
 // pcaNarrative blob (NOT resolvePcaNarrative, which only knows the 9
 // free-prose block keys and would strip these three).
 const rawNarrative = (inspection as { pcaNarrative?: { userReliance?: string; pointInTime?: string; siteSpecific?: string } }).pcaNarrative;
 const relianceText = {
   userReliance: rawNarrative?.userReliance || RELIANCE_TEMPLATES.userReliance,
   pointInTime:  rawNarrative?.pointInTime  || RELIANCE_TEMPLATES.pointInTime,
   siteSpecific: rawNarrative?.siteSpecific || RELIANCE_TEMPLATES.siteSpecific,
 };

 // Commercial subtype-preset field definitions for PropertyInfoForm (design
 // 2026-07-13). commercial-subtypes is a server-only module — it never reaches
 // the client bundle; only these resolved field arrays cross the loader
 // boundary. Keyed `commercial:<subtype>`; the editor picks the active one off
 // state.inspection.commercialSubtype so the Property Info field list reacts
 // live to the Phase T subtype selector with no extra fetch. Commercial subset
 // only — residential inspections keep PropertyInfoForm's own default fields.
 const commercialPresets: Record<string, PropertyMetaField[]> = {};
 for (const [key, fields] of Object.entries(METADATA_PRESETS)) {
   if (key.startsWith("commercial:")) commercialPresets[key] = fields;
 }

 // Null for every inspection whose template declares no statutory form, which
 // is almost all of them. The editor reads the null as "there is no such panel
 // here" rather than as "the panel is empty".
 type StatutoryDetails = {
   inspectorSignatureDate: string | null;
   employeePrintedName: string | null;
   ownerName: string | null;
   ownerEmail: string | null;
   ownerMailingAddress: string | null;
   ownerHomePhone: string | null;
   ownerWorkPhone: string | null;
   ownerCellPhone: string | null;
 };
 let statutoryDetails: StatutoryDetails | null = null;
 if (statutoryDetailsRes?.ok) {
   const body = await statutoryDetailsRes.json() as { data?: StatutoryDetails };
   statutoryDetails = body.data ?? null;
 }

 // ⚠️ NULL IS NOT "NOTHING IS MISSING". Null means the question could not be
 // answered — no statutory form here, or the request failed — and the panel
 // does not render at all. An empty `missing` array is the OTHER thing: the
 // question was asked and the answer is "none", which is worth showing. A
 // component that treated the two alike would print a green tick over a form
 // nobody checked, which is the one state worse than printing nothing.
 type StatutoryCoverage = {
   formId: string;
   revision: string | null;
   requiredTotal: number;
   missing: { field: string; provenance: "pre_inspection" | "per_inspection" | "unknown" }[];
 };
 let statutoryCoverage: StatutoryCoverage | null = null;
 if (statutoryCoverageRes?.ok) {
   const body = await statutoryCoverageRes.json() as { data?: StatutoryCoverage | null };
   statutoryCoverage = body.data ?? null;
 }

 return { inspection, schema, results, resultId, ratingLevels, token, tagLibrary, tenantSlug, streamCustomerSubdomain, videoProvider, collabEditing, templateSnapshot, revisionStatus, pcaNarrative, defectCategories, units, unitProgress, unitInspectionMode, compliance, relianceText, commercialPresets, statutoryDetails, statutoryCoverage };
}
