import type { Route } from "../+types/inspection-edit";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { unwrapResultsResponse } from "~/lib/results";
import type { RatingLevel, ResultMap } from "~/hooks/useInspection";

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

 return { inspection, schema, results, ratingLevels, token, tagLibrary, tenantSlug, streamCustomerSubdomain, videoProvider, collabEditing, templateSnapshot };
}
