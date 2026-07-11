import type { Route } from "../+types/inspection-edit";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { unwrapResultsResponse } from "~/lib/results";
import type { RatingLevel, ResultMap } from "~/hooks/useInspection";
import { resolvePcaNarrative } from "../../../server/lib/pca-narrative";
import { RELIANCE_TEMPLATES } from "../../../server/lib/pca-reliance-text";
import type { CompliancePanelData } from "~/components/inspection-edit/CompliancePanel";

export async function loader({ request, params, context }: Route.LoaderArgs) {
 const token = await requireToken(context, request);
 const id = params.id;

 const api = createApi(context, { token });
 const [inspRes, resultsRes, reportRes, tagsRes, sessRes, defectCatRes, unitsRes, unitProgressRes, complianceRes] = await Promise.all([
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
 const streamCustomerSubdomain =
   ((context.cloudflare?.env as { STREAM_CUSTOMER_SUBDOMAIN?: string } | undefined)?.STREAM_CUSTOMER_SUBDOMAIN) ?? null;

 // D8 — expose the RAW (un-normalized) snapshot so structural ops (addSection /
 // duplicateSection / deleteSection / moveSection) can operate on a clean
 // TemplateSchemaV2 object. The `schema` field above is NORMALIZED (overlaid
 // with report-data) and must NOT be PATCHed to the template-snapshot endpoint.
 const templateSnapshot = ((typeof rawSchema === 'string' ? JSON.parse(rawSchema) : rawSchema) ?? { schemaVersion: 2, sections: [] }) as { schemaVersion: 2; sections: unknown[] };

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

 return { inspection, schema, results, ratingLevels, token, tagLibrary, tenantSlug, streamCustomerSubdomain, videoProvider, collabEditing, templateSnapshot, pcaNarrative, defectCategories, units, unitProgress, unitInspectionMode, compliance, relianceText };
}
