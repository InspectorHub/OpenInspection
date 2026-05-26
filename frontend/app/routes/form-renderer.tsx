import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useLoaderData, useFetcher, Link } from "react-router";
import type { Route } from "./+types/form-renderer";
import { requireToken } from "~/lib/session.server";
import { apiFetch } from "~/lib/api.server";

export function meta() {
 return [{ title: "Inspection Form - OpenInspection" }];
}

/* ------------------------------------------------------------------ */
/* Types */
/* ------------------------------------------------------------------ */

interface ItemOptions {
 min?: number | null;
 max?: number | null;
 unit?: string;
 step?: number | null;
 placeholder?: string;
 maxLength?: number | null;
 choices?: string[];
 minPhotos?: number | null;
}

interface CannedComment {
 id: string;
 title: string;
 comment: string;
 default?: boolean;
}

interface TemplateItem {
 id: string;
 label: string;
 type: "text" | "number" | "boolean" | "select" | "multi_select" | "textarea" | "date" | "photo_only" | "rich";
 description?: string;
 options?: ItemOptions;
 required?: boolean;
 isSafety?: boolean;
 ratingOptions?: string[];
 tabs?: {
 information?: CannedComment[];
 limitations?: CannedComment[];
 defects?: CannedComment[];
 };
}

interface TemplateSection {
 id: string;
 title: string;
 disclaimerText?: string;
 items: TemplateItem[];
}

interface ItemResult {
 rating?: string | null;
 value?: string | boolean | number | null;
 notes?: string;
 photos?: { key: string }[];
}

/* ------------------------------------------------------------------ */
/* Loader */
/* ------------------------------------------------------------------ */

export async function loader({ request, params }: Route.LoaderArgs) {
 const token = await requireToken(request);
 const id = params.id;

 try {
 const [inspRes, resultsRes] = await Promise.all([
 apiFetch(`/api/inspections/${id}`, { token }),
 apiFetch(`/api/inspections/${id}/results`, { token }).catch(() => null),
 ]);
 const inspBody = inspRes.ok ? await inspRes.json() : {};
 const data = ((inspBody as Record<string, unknown>).data ?? {}) as Record<string, unknown> | undefined;

 // Template schema from snapshot or direct
 let schema: { sections: TemplateSection[] } | null = null;
 if (data?.templateSnapshot) {
 schema = data.templateSnapshot as { sections: TemplateSection[] };
 } else if (data?.template) {
 const tpl = data.template as Record<string, unknown>;
 const raw = tpl.schema;
 schema = typeof raw === "string" ? JSON.parse(raw) : raw as { sections: TemplateSection[] };
 }

 // Normalize name/title
 if (schema?.sections) {
 schema.sections = schema.sections.map((sec) => {
 const s = { ...sec };
 if (!s.title && (s as unknown as Record<string, string>).name) {
 s.title = (s as unknown as Record<string, string>).name;
 }
 if (s.items) {
 s.items = s.items.map((item) => {
 const it = { ...item };
 if (!it.label && (it as unknown as Record<string, string>).name) {
 it.label = (it as unknown as Record<string, string>).name;
 }
 return it;
 });
 }
 return s;
 });
 }

 // Existing results
 let existingResults: Record<string, ItemResult> = {};
 if (resultsRes && resultsRes.ok) {
 const rj = await resultsRes.json();
 existingResults = ((rj as Record<string, unknown>).data ?? {}) as Record<string, ItemResult>;
 }

 return {
 inspectionId: id,
 address: (data?.propertyAddress as string) || (data?.address as string) || "",
 status: (data?.status as string) || "",
 sections: schema?.sections ?? [],
 existingResults,
 error: inspRes.ok ? null : "Inspection not found",
 };
 } catch {
 return {
 inspectionId: id,
 address: "",
 status: "",
 sections: [] as TemplateSection[],
 existingResults: {} as Record<string, ItemResult>,
 error: "Service unavailable",
 };
 }
}

/* ------------------------------------------------------------------ */
/* Action */
/* ------------------------------------------------------------------ */

export async function action({ request, params }: Route.ActionArgs) {
 const token = await requireToken(request);
 const formData = await request.formData();
 const intent = formData.get("intent");

 if (intent === "save") {
 const results = formData.get("results") as string;
 if (!results) return { error: "No results" };
 const res = await apiFetch(`/api/inspections/${params.id}/results/batch`, {
 method: "POST",
 token,
 body: results,
 });
 if (!res.ok) return { error: "Failed to save results" };
 return { success: true };
 }

 if (intent === "complete") {
 const res = await apiFetch(`/api/inspections/${params.id}/complete`, {
 method: "POST",
 token,
 });
 if (!res.ok) return { error: "Failed to mark as complete" };
 return { completed: true };
 }

 return { error: "Unknown intent" };
}

/* ------------------------------------------------------------------ */
/* Field renderer */
/* ------------------------------------------------------------------ */

function FormField({
 item,
 value,
 onChange,
}: {
 item: TemplateItem;
 value: string | boolean | number;
 onChange: (val: string | boolean | number) => void;
}) {
 const base =
 "w-full px-3 py-2 rounded-lg border border-ih-border bg-ih-bg-card text-ih-fg-1 text-[13px] focus:shadow-ih-focus focus:border-indigo-500 outline-none";

 switch (item.type) {
 case "boolean":
 return (
 <label className="flex items-center gap-2">
 <input
 type="checkbox"
 checked={!!value}
 onChange={(e) => onChange(e.target.checked)}
 className="accent-indigo-600"
 />
 <span className="text-[13px] text-ih-fg-3">
 {item.label}
 </span>
 </label>
 );
 case "select":
 return (
 <select value={String(value || "")} onChange={(e) => onChange(e.target.value)} className={base}>
 <option value="">Select...</option>
 {item.options?.choices?.map((opt) => (
 <option key={opt} value={opt}>{opt}</option>
 ))}
 </select>
 );
 case "multi_select":
 return (
 <select
 multiple
 value={String(value || "").split(",").filter(Boolean)}
 onChange={(e) => {
 const selected = Array.from(e.target.selectedOptions).map((o) => o.value);
 onChange(selected.join(","));
 }}
 className={`${base} min-h-[80px]`}
 >
 {item.options?.choices?.map((opt) => (
 <option key={opt} value={opt}>{opt}</option>
 ))}
 </select>
 );
 case "textarea":
 return (
 <textarea
 value={String(value || "")}
 onChange={(e) => onChange(e.target.value)}
 rows={3}
 className={base}
 placeholder={item.options?.placeholder || item.label}
 maxLength={item.options?.maxLength ?? undefined}
 />
 );
 case "number":
 return (
 <input
 type="number"
 value={value === "" || value == null ? "" : Number(value)}
 onChange={(e) => onChange(e.target.value ? Number(e.target.value) : "")}
 className={base}
 placeholder={item.options?.placeholder || item.label}
 min={item.options?.min ?? undefined}
 max={item.options?.max ?? undefined}
 step={item.options?.step ?? undefined}
 />
 );
 case "date":
 return (
 <input
 type="date"
 value={String(value || "")}
 onChange={(e) => onChange(e.target.value)}
 className={base}
 />
 );
 case "photo_only":
 return (
 <div className="p-4 rounded-lg border border-dashed border-ih-border-strong text-center text-[13px] text-slate-400">
 Photo capture is available in the inspection editor
 </div>
 );
 case "rich":
 return null; // Handled by RichItemRenderer
 default:
 return (
 <input
 type="text"
 value={String(value || "")}
 onChange={(e) => onChange(e.target.value)}
 className={base}
 placeholder={item.options?.placeholder || item.label}
 maxLength={item.options?.maxLength ?? undefined}
 />
 );
 }
}

/* ---- Rich item renderer (rating + notes) ---- */
function RichItemRenderer({
 item,
 result,
 onRatingChange,
 onNotesChange,
 ratingOptions,
}: {
 item: TemplateItem;
 result: ItemResult;
 onRatingChange: (rating: string) => void;
 onNotesChange: (notes: string) => void;
 ratingOptions: string[];
}) {
 return (
 <div className="space-y-2">
 {/* Rating buttons */}
 <div className="flex flex-wrap gap-1.5">
 {ratingOptions.map((opt) => (
 <button
 key={opt}
 type="button"
 onClick={() => onRatingChange(opt)}
 className={`px-3 py-1.5 rounded-md text-[11px] font-bold border transition-colors ${
 result.rating === opt
 ? "border-indigo-600 bg-indigo-50 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400 dark:border-indigo-400"
 : "border-ih-border text-ih-fg-3 hover:border-slate-300"
 }`}
 >
 {opt}
 </button>
 ))}
 </div>
 {/* Notes */}
 <textarea
 value={result.notes || ""}
 onChange={(e) => onNotesChange(e.target.value)}
 rows={2}
 placeholder="Notes..."
 className="w-full px-3 py-2 rounded-lg border border-ih-border bg-ih-bg-card text-ih-fg-1 text-[13px] focus:shadow-ih-focus focus:border-indigo-500 outline-none"
 />
 {/* Canned comments (quick insert) */}
 {item.tabs && (
 <div className="flex flex-wrap gap-1">
 {(["information", "limitations", "defects"] as const).map((tab) =>
 (item.tabs?.[tab] || []).filter((c) => c.default).map((c) => (
 <button
 key={c.id}
 type="button"
 onClick={() => onNotesChange((result.notes || "") + (result.notes ? "\n" : "") + c.comment)}
 className="text-[10px] px-2 py-0.5 rounded bg-ih-bg-muted text-ih-fg-3 hover:bg-indigo-50 hover:text-ih-primary transition-colors"
 title={c.comment}
 >
 {c.title || c.comment.slice(0, 30)}
 </button>
 )),
 )}
 </div>
 )}
 </div>
 );
}

/* ------------------------------------------------------------------ */
/* Component */
/* ------------------------------------------------------------------ */

export default function FormRendererPage() {
 const { inspectionId, address, status, sections, existingResults, error } = useLoaderData<typeof loader>();
 const fetcher = useFetcher();

 /* ---- Local results state ---- */
 const [results, setResults] = useState<Record<string, ItemResult>>(() => {
 // Initialize with template defaults
 const init: Record<string, ItemResult> = {};
 for (const sec of sections) {
 for (const item of sec.items) {
 const key = `_default:${sec.id}:${item.id}`;
 init[key] = existingResults[key] || existingResults[item.id] || {
 rating: null,
 value: null,
 notes: "",
 photos: [],
 };
 }
 }
 return init;
 });

 const [openSections, setOpenSections] = useState<Set<string>>(() => {
 const first = sections[0]?.id;
 return first ? new Set([first]) : new Set<string>();
 });
 const [activeSectionIdx, setActiveSectionIdx] = useState(0);

 const fetcherData = fetcher.data as { success?: boolean; error?: string; completed?: boolean } | undefined;
 const isSaving = fetcher.state === "submitting";

 /* ---- Helpers ---- */
 function getKey(sectionId: string, itemId: string) {
 return `_default:${sectionId}:${itemId}`;
 }

 function getResult(sectionId: string, itemId: string): ItemResult {
 const key = getKey(sectionId, itemId);
 return results[key] || { rating: null, value: null, notes: "", photos: [] };
 }

 function updateResult(sectionId: string, itemId: string, patch: Partial<ItemResult>) {
 const key = getKey(sectionId, itemId);
 setResults((prev) => ({
 ...prev,
 [key]: { ...prev[key], ...patch },
 }));
 }

 function toggleSection(id: string) {
 setOpenSections((prev) => {
 const next = new Set(prev);
 next.has(id) ? next.delete(id) : next.add(id);
 return next;
 });
 }

 /* ---- Progress ---- */
 const totalItems = sections.reduce((acc, s) => acc + s.items.length, 0);
 const filledItems = useMemo(() => {
 let count = 0;
 for (const sec of sections) {
 for (const item of sec.items) {
 const r = getResult(sec.id, item.id);
 if (item.type === "rich" ? r.rating : r.value != null && r.value !== "") count++;
 }
 }
 return count;
 }, [results, sections]);

 const progress = totalItems > 0 ? Math.round((filledItems / totalItems) * 100) : 0;

 /* ---- Save ---- */
 function handleSave() {
 fetcher.submit(
 { intent: "save", results: JSON.stringify({ results }) },
 { method: "post" },
 );
 }

 function handleComplete() {
 fetcher.submit(
 { intent: "complete" },
 { method: "post" },
 );
 }

 /* ---- Section nav ---- */
 function goToSection(idx: number) {
 setActiveSectionIdx(idx);
 const sec = sections[idx];
 if (sec) {
 setOpenSections((prev) => new Set([...prev, sec.id]));
 }
 }

 if (error) {
 return (
 <div className="p-8 text-center">
 <h1 className="text-2xl font-bold text-ih-fg-1">Form Unavailable</h1>
 <p className="text-ih-fg-3 mt-2">{error}</p>
 </div>
 );
 }

 return (
 <div className="max-w-2xl mx-auto py-8 px-6">
 {/* Header */}
 <div className="flex items-center justify-between mb-6">
 <div>
 <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-primary mb-1">
 Inspection Form
 </div>
 <h1 className="text-2xl font-bold text-ih-fg-1">
 {address || "Field Checklist"}
 </h1>
 <p className="text-[11px] text-slate-400 font-mono mt-0.5">
 #{String(inspectionId || "").slice(0, 8).toUpperCase()}
 {status && <span className="ml-2 text-ih-fg-3">{status.replace(/_/g, " ")}</span>}
 </p>
 </div>
 <Link
 to="/dashboard"
 className="h-8 px-3 rounded-md border border-ih-border text-[12px] font-medium text-ih-fg-3 hover:bg-ih-bg-muted transition-colors inline-flex items-center gap-1.5"
 >
 <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
 </svg>
 Dashboard
 </Link>
 </div>

 {/* Progress bar */}
 <div className="mb-6">
 <div className="flex items-center justify-between mb-1">
 <span className="text-[12px] font-bold text-ih-fg-3">{progress}% complete</span>
 <span className="text-[11px] text-slate-400">{filledItems}/{totalItems} items</span>
 </div>
 <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
 <div
 className="h-full rounded-full bg-ih-primary transition-all duration-300"
 style={{ width: `${progress}%` }}
 />
 </div>
 </div>

 {/* Section nav strip */}
 <div className="flex items-center gap-1 mb-6 overflow-x-auto pb-1">
 {sections.map((sec, idx) => {
 const secFilled = sec.items.filter((item) => {
 const r = getResult(sec.id, item.id);
 return item.type === "rich" ? r.rating : r.value != null && r.value !== "";
 }).length;
 return (
 <button
 key={sec.id}
 onClick={() => goToSection(idx)}
 className={`shrink-0 px-3 py-1.5 rounded-md text-[11px] font-bold transition-colors ${
 activeSectionIdx === idx
 ? "bg-ih-primary text-white"
 : "bg-ih-bg-muted text-ih-fg-3 hover:bg-slate-200"
 }`}
 >
 {sec.title}
 <span className="ml-1 opacity-70">{secFilled}/{sec.items.length}</span>
 </button>
 );
 })}
 </div>

 {/* Success / Error messages */}
 {fetcherData?.success && (
 <div className="mb-6 px-4 py-3 rounded-lg bg-ih-ok-bg border border-ih-ok text-[13px] font-medium text-ih-ok-fg text-center">
 Results saved successfully.
 </div>
 )}
 {fetcherData?.completed && (
 <div className="mb-6 px-4 py-3 rounded-lg bg-ih-ok-bg border border-ih-ok text-[13px] font-medium text-ih-ok-fg text-center">
 Inspection marked as complete!
 </div>
 )}
 {fetcherData?.error && (
 <div className="mb-6 px-4 py-3 rounded-lg bg-ih-bad-bg border border-ih-bad text-[13px] font-medium text-ih-bad-fg text-center">
 {fetcherData.error}
 </div>
 )}

 {/* Sections */}
 <div className="space-y-6">
 {sections.map((section, secIdx) => (
 <fieldset
 key={section.id}
 className="bg-ih-bg-card border border-ih-border rounded-xl overflow-hidden"
 >
 <button
 type="button"
 onClick={() => toggleSection(section.id)}
 className="w-full flex items-center justify-between px-5 py-3 hover:bg-ih-bg-muted/30 transition-colors"
 >
 <div className="flex items-center gap-2">
 <span className="text-[13px] font-bold text-ih-fg-1">
 {section.title}
 </span>
 <span className="text-[10px] text-slate-400 font-mono">
 {section.items.length} {section.items.length === 1 ? "item" : "items"}
 </span>
 </div>
 <svg
 className={`w-4 h-4 text-slate-400 transition-transform ${openSections.has(section.id) ? "rotate-180" : ""}`}
 fill="none" stroke="currentColor" viewBox="0 0 24 24"
 >
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
 </svg>
 </button>

 {section.disclaimerText && openSections.has(section.id) && (
 <div className="px-5 py-2 bg-ih-watch-bg text-[11px] text-ih-watch-fg border-t border-ih-watch">
 {section.disclaimerText}
 </div>
 )}

 {openSections.has(section.id) && (
 <div className="px-5 py-4 space-y-5 border-t border-slate-100 dark:border-slate-700">
 {section.items.map((item) => {
 const r = getResult(section.id, item.id);
 return (
 <div key={item.id}>
 {item.type !== "boolean" && (
 <label className="block text-[12px] font-bold text-ih-fg-3 mb-1">
 {item.label}
 {item.required && <span className="text-ih-bad ml-0.5">*</span>}
 {item.isSafety && <span className="ml-1 text-[9px] font-bold text-ih-bad bg-ih-bad-bg px-1 py-0.5 rounded">SAFETY</span>}
 </label>
 )}
 {item.description && (
 <p className="text-[11px] text-slate-400 mb-1.5">{item.description}</p>
 )}
 {item.type === "rich" ? (
 <RichItemRenderer
 item={item}
 result={r}
 ratingOptions={item.ratingOptions || ["Inspected", "Not Inspected"]}
 onRatingChange={(rating) => updateResult(section.id, item.id, { rating })}
 onNotesChange={(notes) => updateResult(section.id, item.id, { notes })}
 />
 ) : (
 <FormField
 item={item}
 value={r.value ?? ""}
 onChange={(val) => updateResult(section.id, item.id, { value: val })}
 />
 )}
 </div>
 );
 })}
 </div>
 )}
 </fieldset>
 ))}
 </div>

 {/* Action buttons */}
 {sections.length > 0 && (
 <div className="flex items-center gap-3 mt-8">
 <button
 type="button"
 onClick={handleSave}
 disabled={isSaving}
 className="flex-1 py-2.5 rounded-lg bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
 >
 {isSaving ? "Saving..." : "Save Results"}
 </button>
 {progress === 100 && (
 <button
 type="button"
 onClick={handleComplete}
 disabled={isSaving}
 className="py-2.5 px-6 rounded-lg bg-emerald-600 text-white font-bold text-[13px] hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
 >
 Complete
 </button>
 )}
 </div>
 )}

 {/* Section navigation */}
 {sections.length > 1 && (
 <div className="flex items-center justify-between mt-4">
 <button
 onClick={() => goToSection(Math.max(0, activeSectionIdx - 1))}
 disabled={activeSectionIdx === 0}
 className="text-[12px] font-bold text-ih-fg-3 hover:text-ih-primary disabled:opacity-30 disabled:cursor-not-allowed"
 >
 &larr; Previous section
 </button>
 <span className="text-[11px] text-slate-400">
 {activeSectionIdx + 1} / {sections.length}
 </span>
 <button
 onClick={() => goToSection(Math.min(sections.length - 1, activeSectionIdx + 1))}
 disabled={activeSectionIdx === sections.length - 1}
 className="text-[12px] font-bold text-ih-fg-3 hover:text-ih-primary disabled:opacity-30 disabled:cursor-not-allowed"
 >
 Next section &rarr;
 </button>
 </div>
 )}

 {sections.length === 0 && (
 <div className="p-6 rounded-lg border border-dashed border-ih-border-strong text-center text-[13px] text-slate-400">
 No template sections found for this inspection.
 </div>
 )}
 </div>
 );
}
