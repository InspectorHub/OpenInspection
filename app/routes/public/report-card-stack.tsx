import { useState, useCallback } from "react";
import { useLoaderData } from "react-router";
import type { Route } from "./+types/report-card-stack";
import { createApi } from "~/lib/api-client.server";

export function meta({ data }: Route.MetaArgs) {
 const d = data as LoaderResult | undefined;
 return [{ title: `Report - ${d?.address ?? "Inspection"} - OpenInspection` }];
}

/* ------------------------------------------------------------------ */
/* Types */
/* ------------------------------------------------------------------ */

interface ReportItem {
 id: string;
 label: string;
 type?: string;
 rating: string | null;
 ratingColor: string;
 ratingLabel: string | null;
 severityBucket: string;
 notes: string | null;
 photos: Array<{ key: string; url: string }>;
 recommendation?: string | null;
 estimateMin?: number | null;
 estimateMax?: number | null;
 value?: unknown;
 unit?: string | null;
}

interface ReportSection {
 id: string;
 title: string;
 icon?: string | null;
 defectCount: number;
 items: ReportItem[];
 disclaimerText?: string | null;
 alwaysPageBreak?: boolean;
}

interface LoaderResult {
 inspectionId: string;
 address: string;
 date: string;
 inspectorName: string | null;
 stats: { total: number; satisfactory: number; monitor: number; defect: number };
 sections: ReportSection[];
 showEstimates: boolean;
 enableRepairList: boolean;
 enableCustomerRepairExport: boolean;
 messageToken: string | null;
 isDelivered: boolean;
 error: string | null;
 reportTheme?: string;
}

/* ------------------------------------------------------------------ */
/* Loader */
/* ------------------------------------------------------------------ */

export async function loader({ params, context }: Route.LoaderArgs) {
 try {
 const api = createApi(context);
 const res = await api.publicShare.report[":tenant"][":id"].$get({
 param: { tenant: params.tenant ?? "", id: params.id ?? "" },
 });
 const body = res.ok ? await res.json() : {};
 const d = ((body as Record<string, unknown>).data ?? {}) as unknown as LoaderResult | undefined;
 return {
 inspectionId: d?.inspectionId ?? params.id ?? "",
 address: d?.address ?? "",
 date: d?.date ?? "",
 inspectorName: d?.inspectorName ?? null,
 stats: d?.stats ?? { total: 0, satisfactory: 0, monitor: 0, defect: 0 },
 sections: d?.sections ?? [],
 showEstimates: d?.showEstimates ?? false,
 enableRepairList: d?.enableRepairList ?? false,
 enableCustomerRepairExport: d?.enableCustomerRepairExport ?? false,
 messageToken: d?.messageToken ?? null,
 isDelivered: d?.isDelivered ?? false,
 error: res.ok ? null : "Report not found",
 reportTheme: (d as Record<string, unknown>)?.reportTheme as string | undefined,
 } satisfies LoaderResult;
 } catch {
 return {
 inspectionId: "",
 address: "",
 date: "",
 inspectorName: null,
 stats: { total: 0, satisfactory: 0, monitor: 0, defect: 0 },
 sections: [],
 showEstimates: false,
 enableRepairList: false,
 enableCustomerRepairExport: false,
 messageToken: null,
 isDelivered: false,
 error: "Service unavailable",
 } satisfies LoaderResult;
 }
}

/* ------------------------------------------------------------------ */
/* Section icon mapping */
/* ------------------------------------------------------------------ */

const SECTION_ICONS: Record<string, string> = {
 roof: "🏠",
 exterior: "🏗️",
 electrical: "⚡",
 plumbing: "🔧",
 hvac: "❄️",
 interior: "🛋️",
 structural: "🏛️",
 appliances: "🔌",
};

function getSectionIcon(title: string): string {
 const key = title.toLowerCase().replace(/[^a-z]/g, "");
 for (const [k, v] of Object.entries(SECTION_ICONS)) {
 if (key.includes(k)) return v;
 }
 return "📋";
}

/* ------------------------------------------------------------------ */
/* Filter types */
/* ------------------------------------------------------------------ */

type FilterKey = "all" | "defects" | "summary";

function isDefect(bucket: string): boolean {
 return /defect|safety|major/i.test(bucket);
}

/* ------------------------------------------------------------------ */
/* Page */
/* ------------------------------------------------------------------ */

export default function ReportCardStackPage() {
 const data = useLoaderData<typeof loader>() as LoaderResult;
 const [filter, setFilter] = useState<FilterKey>("all");
 const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
 const [repairPanel, setRepairPanel] = useState(false);
 const [repairItems, setRepairItems] = useState<Record<string, boolean>>({});

 if (data.error) {
 return (
 <div className="min-h-screen flex items-center justify-center p-6">
 <p className="text-ih-fg-3">{data.error}</p>
 </div>
 );
 }

 const toggleRepairItem = (id: string) => {
 setRepairItems((prev) => ({ ...prev, [id]: !prev[id] }));
 };

 const selectedRepairList = data.sections
 .flatMap((s) => s.items)
 .filter((item) => repairItems[item.id]);

 const filteredSections =
 filter === "defects"
 ? data.sections
 .filter((s) => s.defectCount > 0)
 .map((s) => ({
 ...s,
 items: s.items.filter((i) => isDefect(i.severityBucket)),
 }))
 : data.sections;

 return (
 <div className="min-h-screen bg-ih-bg-card" data-theme={data.reportTheme || undefined}>
 {/* Download PDF FAB */}
 <button
 type="button"
 onClick={() => window.print()}
 className="print:hidden fixed bottom-6 right-6 z-50 px-5 py-3 rounded-full bg-slate-900 text-white text-xs font-bold uppercase tracking-widest shadow-2xl hover:bg-ih-primary transition-all flex items-center gap-2"
 >
 <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
 </svg>
 Download PDF
 </button>

 {/* Header */}
 <div className="max-w-4xl mx-auto px-4 sm:px-6 pt-8 pb-6">
 <div className="flex items-start justify-between mb-6">
 <div className="flex items-center gap-3">
 <div className="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center">
 <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
 </svg>
 </div>
 <span className="text-xs font-semibold tracking-widest uppercase text-ih-fg-4">
 Certified Inspection Report
 </span>
 </div>
 <div className="flex items-center gap-2 print:hidden">
 {data.messageToken && (
 <a
 href={`/messages/${data.messageToken}`}
 className="px-4 py-2 text-sm font-medium rounded-lg border border-ih-border text-ih-fg-3 flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
 >
 Message Inspector
 </a>
 )}
 {data.enableRepairList && (
 <a
 href={`/inspections/${data.inspectionId}/repair-list`}
 className="px-4 py-2 text-sm font-medium rounded-lg border border-ih-border text-ih-fg-3 flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
 >
 View Repair List
 </a>
 )}
 {data.enableCustomerRepairExport && (
 <a
 href={`/r/${data.inspectionId}/repair-request`}
 className="px-4 py-2 text-sm font-medium rounded-lg border border-ih-border text-ih-fg-3 flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
 >
 Generate repair request
 </a>
 )}
 <button
 type="button"
 onClick={() => window.print()}
 className="px-4 py-2 text-sm font-medium rounded-lg border border-ih-border text-ih-fg-3 flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
 >
 PDF
 </button>
 <button
 type="button"
 onClick={() => setRepairPanel(!repairPanel)}
 className="px-4 py-2 text-sm font-semibold rounded-lg bg-ih-primary text-white flex items-center gap-2"
 >
 Repair Request
 </button>
 </div>
 </div>
 <h1 className="text-2xl sm:text-3xl font-bold leading-tight mb-2 text-ih-fg-1">
 {data.address}
 </h1>
 <p className="text-sm text-ih-fg-3">
 {data.date} &middot; Inspector: {data.inspectorName || "N/A"}
 </p>
 </div>

 {/* Stats */}
 <div className="max-w-4xl mx-auto px-4 sm:px-6 mb-6">
 <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
 {[
 { label: "Total", value: data.stats.total, color: "text-ih-fg-1" },
 { label: "Satisfactory", value: data.stats.satisfactory, color: "text-green-600 dark:text-green-400" },
 { label: "Monitor", value: data.stats.monitor, color: "text-ih-watch-fg" },
 { label: "Defects", value: data.stats.defect, color: "text-ih-bad-fg" },
 ].map((s) => (
 <div key={s.label} className="bg-ih-bg-card border border-ih-border rounded-lg p-4 text-center">
 <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
 <div className="text-[11px] text-ih-fg-4 uppercase tracking-widest mt-1">
 {s.label}
 </div>
 </div>
 ))}
 </div>
 </div>

 {/* Filter chips */}
 <div className="max-w-4xl mx-auto px-4 sm:px-6 mb-8">
 <div className="flex gap-2">
 {(["all", "defects", "summary"] as FilterKey[]).map((f) => (
 <button
 key={f}
 type="button"
 onClick={() => setFilter(f)}
 className={`px-4 py-1.5 text-xs font-semibold rounded-full transition-all ${
 filter === f
 ? "bg-ih-primary text-white"
 : "border border-ih-border text-ih-fg-3"
 }`}
 >
 {f === "all" ? "All" : f === "defects" ? "Defects Only" : "Summary"}
 </button>
 ))}
 </div>
 </div>

 {/* Sections */}
 <div className={`max-w-4xl mx-auto px-4 sm:px-6 ${repairPanel ? "pb-[65vh]" : "pb-32"}`}>
 {filteredSections.map((section, sectionIdx) => {
 if (filter === "defects" && section.items.length === 0) return null;
 return (
 <div key={section.id} className="mb-6 group/section relative">
 <div className="flex items-center gap-3 mb-4">
 <span className="text-2xl">{getSectionIcon(section.title)}</span>
 <h2 className="text-2xl font-bold italic text-ih-fg-1">
 <span className="font-mono not-italic mr-1 text-ih-fg-4">
 {sectionIdx + 1} -
 </span>
 {section.title}
 </h2>
 <div className="flex-1 h-px border-t border-ih-border" />
 <span className="text-xs font-mono text-ih-fg-4">
 {section.items.length} items
 </span>
 </div>

 {/* Items (hidden in summary mode) */}
 {filter !== "summary" && (
 <div className="space-y-3">
 {section.items.map((item) => (
 <div
 key={item.id}
 className="bg-ih-bg-card border border-ih-border rounded-lg overflow-hidden"
 style={{ borderLeftWidth: 4, borderLeftColor: item.ratingColor }}
 >
 <div className="p-4">
 <div className="flex items-start justify-between mb-2">
 <h3 className="font-semibold text-ih-fg-1">
 {item.label}
 </h3>
 {item.ratingLabel && (
 <span
 className="text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wide"
 style={{
 background: `${item.ratingColor}20`,
 color: item.ratingColor,
 }}
 >
 {item.ratingLabel}
 </span>
 )}
 </div>

 {/* Non-rich item value */}
 {item.type &&
 item.type !== "rich" &&
 item.value !== undefined &&
 item.value !== null &&
 item.value !== "" && (
 <p className="mt-2 text-sm font-semibold text-ih-fg-1">
 <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-4 mr-2">
 {item.type}
 </span>
 {Array.isArray(item.value)
 ? (item.value as unknown[]).join(" · ")
 : item.type === "boolean"
 ? (item.value as boolean)
 ? "Yes"
 : "No"
 : String(item.value)}
 {item.unit && (
 <span className="text-ih-fg-4 ml-1.5">
 {item.unit}
 </span>
 )}
 </p>
 )}

 {item.notes && (
 <p className="text-sm text-ih-fg-3 mt-2 leading-relaxed">
 {item.notes}
 </p>
 )}

 {item.recommendation && (
 <div className="mt-2 flex items-center gap-2 flex-wrap">
 <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 uppercase">
 Recommend: {item.recommendation}
 </span>
 {data.showEstimates &&
 (item.estimateMin != null || item.estimateMax != null) && (
 <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-ih-ok-bg text-ih-ok-fg tabular-nums">
 Estimated cost: $
 {item.estimateMin?.toLocaleString() ?? "?"} - $
 {item.estimateMax?.toLocaleString() ?? "?"}
 </span>
 )}
 </div>
 )}

 {item.photos.length > 0 && (
 <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
 {item.photos.map((photo, idx) => (
 <img
 key={photo.key}
 src={photo.url}
 alt={`${item.label} photo ${idx + 1}`}
 className="w-full h-32 object-cover rounded cursor-pointer"
 loading="lazy"
 onClick={() => setLightboxUrl(photo.url)}
 />
 ))}
 </div>
 )}

 {(item.severityBucket === "defect" ||
 item.severityBucket === "monitor") && (
 <label className="flex items-center gap-2 mt-3 cursor-pointer text-sm text-ih-fg-3">
 <input
 type="checkbox"
 checked={!!repairItems[item.id]}
 onChange={() => toggleRepairItem(item.id)}
 className="rounded border-gray-300"
 />
 Add to repair request
 </label>
 )}
 </div>
 </div>
 ))}
 </div>
 )}

 {/* Summary card */}
 {filter === "summary" && (
 <div className="bg-ih-bg-card border border-ih-border rounded-lg p-4">
 <div className="flex items-center justify-between">
 <span className="font-medium text-ih-fg-1">
 {section.items.length} items inspected
 </span>
 <span
 className="text-sm font-semibold"
 style={{
 color: section.defectCount > 0 ? "#f43f5e" : "#22c55e",
 }}
 >
 {section.defectCount > 0
 ? `${section.defectCount} defect${section.defectCount > 1 ? "s" : ""}`
 : "All clear"}
 </span>
 </div>
 </div>
 )}

 {/* Disclaimer */}
 {section.disclaimerText && filter !== "summary" && (
 <div className="mt-4 px-4 py-3 rounded-md border border-ih-border bg-ih-watch-bg/40 text-[12px] leading-relaxed text-ih-fg-3">
 <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-watch-fg mb-1">
 Disclaimer
 </div>
 <p className="whitespace-pre-line">{section.disclaimerText}</p>
 </div>
 )}
 </div>
 );
 })}
 </div>

 {/* Repair Request Panel */}
 {repairPanel && (
 <div className="fixed bottom-0 left-0 right-0 z-50 bg-ih-bg-card border-t border-ih-border max-h-[60vh] overflow-y-auto rounded-t-xl">
 <div className="max-w-4xl mx-auto p-6">
 <div className="flex items-center justify-between mb-4">
 <h3 className="text-lg font-bold text-ih-fg-1">
 Repair Request
 </h3>
 <button
 type="button"
 onClick={() => setRepairPanel(false)}
 className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
 >
 <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
 </svg>
 </button>
 </div>
 {selectedRepairList.length === 0 ? (
 <div className="text-center py-8 text-ih-fg-4">
 No items selected. Check "Add to repair request" on defect cards above.
 </div>
 ) : (
 <>
 {selectedRepairList.map((item) => (
 <div
 key={item.id}
 className="flex items-center justify-between py-2 border-b border-ih-border"
 >
 <div>
 <span className="font-medium text-sm text-ih-fg-1">
 {item.label}
 </span>
 {item.recommendation && (
 <span className="text-xs text-ih-fg-4 ml-2">
 -- {item.recommendation}
 </span>
 )}
 </div>
 {data.showEstimates &&
 (item.estimateMin || item.estimateMax) && (
 <span className="text-xs font-mono text-ih-fg-4">
 ${item.estimateMin || "?"} - ${item.estimateMax || "?"}
 </span>
 )}
 </div>
 ))}
 <div className="mt-4 flex items-center justify-between">
 <div className="text-sm font-semibold text-ih-fg-1">
 {selectedRepairList.length} items
 </div>
 <div className="flex gap-2">
 <button
 type="button"
 onClick={() => window.print()}
 className="px-4 py-2 text-sm font-medium rounded-lg border border-ih-border text-ih-fg-3"
 >
 Export PDF
 </button>
 <button
 type="button"
 className="px-4 py-2 text-sm font-semibold rounded-lg bg-ih-primary text-white"
 >
 Send to Inspector
 </button>
 </div>
 </div>
 </>
 )}
 </div>
 </div>
 )}

 {/* Lightbox */}
 {lightboxUrl && (
 <div
 className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center p-4 cursor-pointer"
 onClick={() => setLightboxUrl(null)}
 >
 <img
 src={lightboxUrl}
 alt=""
 className="max-w-full max-h-[90vh] object-contain rounded-lg"
 />
 </div>
 )}
 </div>
 );
}
