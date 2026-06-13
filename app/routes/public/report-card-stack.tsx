import { useState } from "react";
import { useLoaderData } from "react-router";
import type { Route } from "./+types/report-card-stack";
import { createApi } from "~/lib/api-client.server";
import { getToken } from "~/lib/session.server";
import { ErrorState } from "~/components/ErrorState";
import { photoDisplayName, withDownload } from "~/lib/photo-name";
import { resolveTenantBrand } from "~/lib/tenant-brand.server";
import { brandTokens, EMPTY_BRAND, type TenantBrand } from "~/lib/brand";

export function meta({ data }: Route.MetaArgs) {
 const d = data as LoaderResult | undefined;
 return [{ title: `Report - ${d?.address ?? "Inspection"} - OpenInspection` }];
}

/* ------------------------------------------------------------------ */
/* Types */
/* ------------------------------------------------------------------ */

interface ResolvedDefect {
 id: string;
 title: string;
 included: boolean;
 isCustom?: boolean;
 effectiveComment: string;
 effectiveCategory?: string;
 effectiveLocation?: string | null;
 defectPhotos?: Array<{ key: string; url: string }>;
}

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
 /** Task 8 — attached repair items snapshotted on this finding (dollars). */
 repairItems?: {
 summary: string;
 estimateMin: number | null;
 estimateMax: number | null;
 contractorType: string | null;
 }[];
 value?: unknown;
 unit?: string | null;
 /** FE-3/B-20 — resolved canned + custom defects (server emits both). */
 resolvedTabs?: {
 defects?: ResolvedDefect[];
 };
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
 coverPhotoUrl: string | null;
 stats: { total: number; satisfactory: number; monitor: number; defect: number };
 sections: ReportSection[];
 showEstimates: boolean;
 enableRepairList: boolean;
 enableCustomerRepairExport: boolean;
 messageToken: string | null;
 isDelivered: boolean;
 brand: TenantBrand;
 error: string | null;
 reportTheme?: string;
}

/* ------------------------------------------------------------------ */
/* Loader */
/* ------------------------------------------------------------------ */

export async function loader({ params, request, context }: Route.LoaderArgs) {
 try {
 // Relay the owner's session JWT when present so the inspector/admin can
 // preview their own report tokenlessly (resolveOwnerPreview server-side).
 // Public client viewers carry no session → getToken returns null → unchanged.
 const sessionToken = (await getToken(context, request)) ?? undefined;
 const api = createApi(context, { token: sessionToken });
 const token = new URL(request.url).searchParams.get("token") ?? undefined;
 const [res, brand] = await Promise.all([
 api.publicReport.report[":tenant"][":id"].$get({
 param: { tenant: params.tenant ?? "", id: params.id ?? "" },
 query: { token },
 }),
 resolveTenantBrand(context, params.tenant),
 ]);
 const body = res.ok ? await res.json() : {};
 const d = ((body as Record<string, unknown>).data ?? {}) as unknown as LoaderResult | undefined;
 // getReportData nests property/inspector/date under `inspection` and names
 // the theme `theme`. Read those (falling back to any top-level aliases) so the
 // report header shows the real address + inspector instead of blanks.
 const meta = d as unknown as {
   inspection?: { propertyAddress?: string | null; date?: string | null; inspectorName?: string | null };
   theme?: string;
 } | undefined;
 return {
 inspectionId: d?.inspectionId ?? params.id ?? "",
 address: d?.address ?? meta?.inspection?.propertyAddress ?? "",
 date: d?.date ?? meta?.inspection?.date ?? "",
 inspectorName: d?.inspectorName ?? meta?.inspection?.inspectorName ?? null,
 coverPhotoUrl: d?.coverPhotoUrl ?? null,
 stats: d?.stats ?? { total: 0, satisfactory: 0, monitor: 0, defect: 0 },
 sections: d?.sections ?? [],
 showEstimates: d?.showEstimates ?? false,
 enableRepairList: d?.enableRepairList ?? false,
 enableCustomerRepairExport: d?.enableCustomerRepairExport ?? false,
 messageToken: d?.messageToken ?? null,
 isDelivered: d?.isDelivered ?? false,
 brand,
 error: res.ok ? null : "Report not found",
 reportTheme: ((d as unknown as Record<string, unknown>)?.reportTheme as string | undefined) ?? meta?.theme,
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
 brand: EMPTY_BRAND,
 coverPhotoUrl: null,
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
 const notFound = data.error === "Report not found";
 return (
 <ErrorState
 title={notFound ? "Report not found" : "Report unavailable"}
 message={
 notFound
 ? "This report link is invalid or has expired. Please contact your inspector for an up-to-date link."
 : "We couldn't load this report right now. Please try again in a moment."
 }
 />
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
 <div className="min-h-screen bg-ih-bg-card" data-theme={data.reportTheme || undefined} style={brandTokens(data.brand.primaryColor)}>
 {/* Download PDF FAB */}
 <button
 type="button"
 onClick={() => window.print()}
 className="print:hidden fixed bottom-6 right-6 z-50 px-5 py-3 rounded-full bg-ih-bg-inverse text-ih-fg-inverse text-xs font-bold uppercase tracking-widest shadow-ih-popover hover:bg-ih-primary transition-all flex items-center gap-2"
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
 {data.brand.logoUrl ? (
 <img src={data.brand.logoUrl} alt={data.brand.siteName ?? "Logo"} className="h-10 w-auto" />
 ) : (
 <div className="w-10 h-10 rounded-full bg-ih-ok/10 flex items-center justify-center">
 <svg className="w-5 h-5 text-ih-ok" fill="none" stroke="currentColor" viewBox="0 0 24 24">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
 </svg>
 </div>
 )}
 <span className="text-xs font-semibold tracking-widest uppercase text-ih-fg-4">
 {data.brand.siteName ? `${data.brand.siteName} · Certified Inspection Report` : "Certified Inspection Report"}
 </span>
 </div>
 <div className="flex items-center gap-2 print:hidden">
 {data.messageToken && (
 <a
 href={`/messages/${data.messageToken}`}
 className="px-4 py-2 text-sm font-medium rounded-lg border border-ih-border text-ih-fg-3 flex items-center gap-2 hover:bg-ih-bg-muted transition-colors"
 >
 Message Inspector
 </a>
 )}
 {data.enableRepairList && (
 <a
 href={`/inspections/${data.inspectionId}/repair-list`}
 className="px-4 py-2 text-sm font-medium rounded-lg border border-ih-border text-ih-fg-3 flex items-center gap-2 hover:bg-ih-bg-muted transition-colors"
 >
 View Repair List
 </a>
 )}
 {data.enableCustomerRepairExport && (
 <a
 href={`/r/${data.inspectionId}/repair-request`}
 className="px-4 py-2 text-sm font-medium rounded-lg border border-ih-border text-ih-fg-3 flex items-center gap-2 hover:bg-ih-bg-muted transition-colors"
 >
 Generate repair request
 </a>
 )}
 <button
 type="button"
 onClick={() => window.print()}
 className="px-4 py-2 text-sm font-medium rounded-lg border border-ih-border text-ih-fg-3 flex items-center gap-2 hover:bg-ih-bg-muted transition-colors"
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

 {/* Cover photo (DB-16) — the inspector-chosen report cover image. Hidden
     gracefully if the underlying photo was removed (onError). */}
 {data.coverPhotoUrl && (
 <div className="max-w-4xl mx-auto px-4 sm:px-6 mb-6">
 <img
 src={data.coverPhotoUrl}
 alt={`Cover photo — ${data.address}`}
 className="w-full max-h-72 object-cover rounded-xl border border-ih-border"
 loading="lazy"
 onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = "none"; }}
 />
 </div>
 )}

 {/* Stats */}
 <div className="max-w-4xl mx-auto px-4 sm:px-6 mb-6">
 <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
 {[
 { label: "Total", value: data.stats.total, color: "text-ih-fg-1" },
 { label: "Satisfactory", value: data.stats.satisfactory, color: "text-ih-ok-fg" },
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

 {/* FE-3/B-20 — findings: included canned + custom defects with their
 own photos. Previously the viewer rendered neither (field-authored
 defects never appeared in the published report at all). */}
 {(item.resolvedTabs?.defects ?? []).filter((d) => d.included).length > 0 && (
 <div className="mt-3 space-y-2">
 {(item.resolvedTabs?.defects ?? [])
 .filter((d) => d.included)
 .map((d) => (
 <div
 key={d.id}
 className="rounded-md border border-ih-border bg-ih-bg-app/60 px-3 py-2"
 >
 <div className="flex items-center gap-1.5 flex-wrap">
 <span className="text-[13px] font-bold text-ih-fg-1">{d.title}</span>
 {d.effectiveCategory && (
 <span
 className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${
 d.effectiveCategory === "safety"
 ? "bg-ih-bad-bg text-ih-bad-fg"
 : d.effectiveCategory === "recommendation"
 ? "bg-ih-watch-bg text-ih-watch-fg"
 : "bg-ih-bg-muted text-ih-fg-2"
 }`}
 >
 {d.effectiveCategory}
 </span>
 )}
 {d.isCustom && (
 <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-ih-primary-tint text-ih-primary">
 inspector-added
 </span>
 )}
 {d.effectiveLocation && (
 <span className="text-[11px] text-ih-fg-4">@ {d.effectiveLocation}</span>
 )}
 </div>
 {d.effectiveComment && (
 <p className="text-[13px] text-ih-fg-3 mt-1 leading-relaxed">
 {d.effectiveComment}
 </p>
 )}
 {(d.defectPhotos ?? []).length > 0 && (
 <div className="mt-2 grid grid-cols-3 sm:grid-cols-4 gap-1.5">
 {(d.defectPhotos ?? []).map((photo) => {
 const name = photoDisplayName(photo.key);
 return (
 <img
 key={photo.key}
 src={photo.url}
 alt={name}
 title={name}
 className="w-full h-20 object-cover rounded cursor-pointer"
 loading="lazy"
 onClick={() => setLightboxUrl(photo.url)}
 />
 );
 })}
 </div>
 )}
 </div>
 ))}
 </div>
 )}

 {item.recommendation && (
 <div className="mt-2 flex items-center gap-2 flex-wrap">
 <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-ih-info-bg text-ih-info-fg uppercase">
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

 {(item.repairItems?.length ?? 0) > 0 && (
 <div className="mt-2 space-y-1.5">
 {item.repairItems!.map((ri, i) => (
 <div key={i} className="flex items-center gap-2 flex-wrap text-[12px]">
 <span className="font-semibold text-ih-fg-2">{ri.summary}</span>
 {ri.contractorType && (
 <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-ih-info-bg text-ih-info-fg uppercase">{ri.contractorType}</span>
 )}
 {data.showEstimates && (ri.estimateMin != null || ri.estimateMax != null) && (
 <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-ih-ok-bg text-ih-ok-fg tabular-nums">
 ${ri.estimateMin?.toLocaleString() ?? "?"} – ${ri.estimateMax?.toLocaleString() ?? "?"}
 </span>
 )}
 </div>
 ))}
 </div>
 )}

 {item.photos.length > 0 && (
 <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
 {item.photos.map((photo) => {
 const name = photoDisplayName(photo.key);
 return (
 <div key={photo.key} className="group relative">
 <img
 src={photo.url}
 alt={name}
 title={name}
 className="w-full h-32 object-cover rounded cursor-pointer"
 loading="lazy"
 onClick={() => setLightboxUrl(photo.url)}
 />
 <a
 href={withDownload(photo.url)}
 download={name}
 title={`Download ${name}`}
 onClick={(e) => e.stopPropagation()}
 className="absolute top-1 right-1 rounded bg-[rgba(15,23,42,0.55)] px-1.5 py-0.5 text-[10px] font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100"
 >
 ↓
 </a>
 </div>
 );
 })}
 </div>
 )}

 {(item.severityBucket === "defect" ||
 item.severityBucket === "monitor") && (
 <label className="flex items-center gap-2 mt-3 cursor-pointer text-sm text-ih-fg-3">
 <input
 type="checkbox"
 checked={!!repairItems[item.id]}
 onChange={() => toggleRepairItem(item.id)}
 className="rounded border-ih-border-strong"
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
 className="text-ih-fg-4 hover:text-ih-fg-2"
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
 className="fixed inset-0 z-[60] bg-[rgba(15,23,42,0.9)] flex items-center justify-center p-4 cursor-pointer"
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
