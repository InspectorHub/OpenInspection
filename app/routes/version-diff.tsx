import { useLoaderData } from "react-router";
import type { Route } from "./+types/version-diff";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { PageHeader } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

export function meta() {
 return [{ title: m.misc_version_diff_meta_title() }];
}

/* ------------------------------------------------------------------ */
/* Types */
/* ------------------------------------------------------------------ */

interface DiffEntry {
 field: string;
 section: string;
 item: string;
 before: string | null;
 after: string | null;
}

/* ------------------------------------------------------------------ */
/* Loader */
/* ------------------------------------------------------------------ */

export async function loader({ request, params, context }: Route.LoaderArgs) {
 const token = await requireToken(context, request);
 const { id } = params;
 const url = new URL(request.url);
 // `version-diff/:id` carries only the inspection id; the target version (`n`)
 // and the baseline to diff against (`from`) ride in the query string.
 const n = url.searchParams.get("n") ?? "";
 const from = url.searchParams.get("from") ?? "";

 try {
 const api = createApi(context, { token });
 const res = await api.inspections[":id"].versions[":n"].diff.$get({
 param: { id, n },
 query: { from },
 });
 if (!res.ok) {
 return { inspectionId: id, version: n, diffs: [] as DiffEntry[], error: m.misc_version_diff_err_not_found() };
 }
 const body = await res.json();
 return {
 inspectionId: id,
 version: n,
 diffs: ((body as Record<string, unknown>).data ?? []) as DiffEntry[],
 error: null,
 };
 } catch {
 return { inspectionId: id, version: n, diffs: [] as DiffEntry[], error: m.misc_version_diff_err_unavailable() };
 }
}

/* ------------------------------------------------------------------ */
/* Component */
/* ------------------------------------------------------------------ */

export default function VersionDiffPage() {
 const { inspectionId, version, diffs, error } =
 useLoaderData<typeof loader>();

 if (error) {
 return (
 <div className="max-w-3xl mx-auto p-8 text-center">
 <h1 className="text-2xl font-bold text-ih-fg-1">
 {m.misc_version_diff_error_heading()}
 </h1>
 <p className="text-ih-fg-3 mt-2">{error}</p>
 <a
 href={`/inspections/${inspectionId}/edit`}
 className="inline-flex items-center mt-4 h-9 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 transition-colors"
 >
 {m.misc_version_diff_back_inspection()}
 </a>
 </div>
 );
 }

 return (
 <div className="max-w-4xl mx-auto py-8 px-6">
 <div className="mb-6">
 <PageHeader
 title={m.misc_version_diff_title({ version })}
 meta={diffs.length === 1
 ? m.misc_version_diff_meta_one({ id: String(inspectionId).slice(0, 8).toUpperCase(), count: diffs.length })
 : m.misc_version_diff_meta_other({ id: String(inspectionId).slice(0, 8).toUpperCase(), count: diffs.length })}
 actions={
 <a
 href={`/inspections/${inspectionId}/edit`}
 className="h-9 px-4 rounded-md border border-ih-border text-[13px] font-bold text-ih-fg-3 hover:bg-ih-bg-muted transition-colors inline-flex items-center"
 >
 {m.misc_version_diff_back_editor()}
 </a>
 }
 />
 </div>

 {/* Diff table */}
 {diffs.length === 0 ? (
 <div className="p-6 rounded-lg border border-dashed border-ih-border-strong text-center text-[13px] text-ih-fg-4">
 {m.misc_version_diff_no_changes()}
 </div>
 ) : (
 <div className="bg-ih-bg-card border border-ih-border rounded-xl overflow-hidden">
 <div className="grid grid-cols-[1fr_1fr_1fr] gap-0 text-[11px] font-bold uppercase tracking-widest text-ih-fg-4 bg-ih-bg-app/30 border-b border-ih-border">
 <div className="px-4 py-3">{m.misc_version_diff_col_field()}</div>
 <div className="px-4 py-3 border-l border-ih-border">
 {m.misc_version_diff_col_before()}
 </div>
 <div className="px-4 py-3 border-l border-ih-border">
 {m.misc_version_diff_col_after()}
 </div>
 </div>

 {diffs.map((d, i) => (
 <div
 key={i}
 className="grid grid-cols-[1fr_1fr_1fr] gap-0 border-b last:border-b-0 border-ih-border"
 >
 <div className="px-4 py-3">
 <p className="text-[13px] font-semibold text-ih-fg-1">
 {d.item}
 </p>
 <p className="text-[11px] text-ih-fg-4 mt-0.5">
 {d.section} / {d.field}
 </p>
 </div>
 <div className="px-4 py-3 border-l border-ih-border bg-ih-bad-bg/50">
 <span className="text-[13px] text-ih-bad-fg">
 {d.before ?? <span className="italic text-ih-fg-4">{m.misc_version_diff_empty_value()}</span>}
 </span>
 </div>
 <div className="px-4 py-3 border-l border-ih-border bg-ih-ok-bg/50">
 <span className="text-[13px] text-ih-ok-fg">
 {d.after ?? <span className="italic text-ih-fg-4">{m.misc_version_diff_empty_value()}</span>}
 </span>
 </div>
 </div>
 ))}
 </div>
 )}
 </div>
 );
}
