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

/** One rendered diff row: a changed field, or an added/removed item or unit. */
export interface DiffRow {
 key: string;
 label: string;
 change: 'added' | 'removed' | 'changed';
 before: string | null; // present only for `changed`
 after: string | null; // present only for `changed`
}

/** The `{ items, units }` payload the diff API actually returns (see
 *  server/lib/version-diff.ts computeDiff). */
interface RawItemDiff {
 itemId: string;
 kind: 'added' | 'removed' | 'changed';
 field?: string;
 from?: unknown;
 to?: unknown;
}
interface RawDiffPayload {
 items?: RawItemDiff[];
 units?: { added?: Array<{ id: string }>; removed?: Array<{ id: string }> };
}

function fmtValue(v: unknown): string | null {
 if (v === null || v === undefined || v === '') return null;
 return typeof v === 'string' ? v : JSON.stringify(v);
}

/**
 * IA-40 — the diff page expected a flat array but the API returns
 * `{ items, units }`, so `data.map` threw on every real diff. This flattens the
 * payload into the rows the table renders. added/removed carry no value
 * (computeDiff records only the kind), so they render as a marker, not a fake
 * before/after.
 */
export function flattenVersionDiff(payload: RawDiffPayload | null | undefined): DiffRow[] {
 if (!payload) return [];
 const rows: DiffRow[] = [];
 for (const it of payload.items ?? []) {
 if (it.kind === 'changed') {
 rows.push({
 key: `${it.itemId}:${it.field ?? ''}`,
 label: it.field ? `${it.itemId} · ${it.field}` : it.itemId,
 change: 'changed',
 before: fmtValue(it.from),
 after: fmtValue(it.to),
 });
 } else {
 rows.push({ key: `${it.itemId}:${it.kind}`, label: it.itemId, change: it.kind, before: null, after: null });
 }
 }
 for (const u of payload.units?.added ?? []) {
 rows.push({ key: `unit:${u.id}:added`, label: `Unit ${u.id}`, change: 'added', before: null, after: null });
 }
 for (const u of payload.units?.removed ?? []) {
 rows.push({ key: `unit:${u.id}:removed`, label: `Unit ${u.id}`, change: 'removed', before: null, after: null });
 }
 return rows;
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
 return { inspectionId: id, version: n, rows: [] as DiffRow[], error: m.misc_version_diff_err_not_found() };
 }
 const body = await res.json();
 const payload = (body as { data?: RawDiffPayload }).data;
 return {
 inspectionId: id,
 version: n,
 rows: flattenVersionDiff(payload),
 error: null,
 };
 } catch {
 return { inspectionId: id, version: n, rows: [] as DiffRow[], error: m.misc_version_diff_err_unavailable() };
 }
}

/* ------------------------------------------------------------------ */
/* Component */
/* ------------------------------------------------------------------ */

export default function VersionDiffPage() {
 const { inspectionId, version, rows, error } =
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
 meta={rows.length === 1
 ? m.misc_version_diff_meta_one({ id: String(inspectionId).slice(0, 8).toUpperCase(), count: rows.length })
 : m.misc_version_diff_meta_other({ id: String(inspectionId).slice(0, 8).toUpperCase(), count: rows.length })}
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
 {rows.length === 0 ? (
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

 {rows.map((r) => (
 <div
 key={r.key}
 className="grid grid-cols-[1fr_1fr_1fr] gap-0 border-b last:border-b-0 border-ih-border"
 >
 <div className="px-4 py-3">
 <p className="text-[13px] font-semibold text-ih-fg-1 break-words">
 {r.label}
 </p>
 </div>
 <div className="px-4 py-3 border-l border-ih-border bg-ih-bad-bg/50">
 <span className="text-[13px] text-ih-bad-fg">
 {r.change === 'removed'
 ? m.misc_version_diff_removed()
 : (r.before ?? <span className="italic text-ih-fg-4">{m.misc_version_diff_empty_value()}</span>)}
 </span>
 </div>
 <div className="px-4 py-3 border-l border-ih-border bg-ih-ok-bg/50">
 <span className="text-[13px] text-ih-ok-fg">
 {r.change === 'added'
 ? m.misc_version_diff_added()
 : (r.after ?? <span className="italic text-ih-fg-4">{m.misc_version_diff_empty_value()}</span>)}
 </span>
 </div>
 </div>
 ))}
 </div>
 )}
 </div>
 );
}
