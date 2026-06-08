import { useLoaderData } from "react-router";
import type { Route } from "./+types/report";
import { createApi } from "~/lib/api-client.server";
import { resolveTenantBrand } from "~/lib/tenant-brand.server";
import { brandTokens, EMPTY_BRAND, type TenantBrand } from "~/lib/brand";
import { readLegalLinks } from "~/lib/legal-links.server";
import { sectionsWithCarriedItems } from "~/lib/reinspection-report";

export function meta() {
 return [{ title: "Inspection Report - OpenInspection" }];
}

interface ReportSection {
 id: string;
 name: string;
 itemCount: number;
 defects: number;
 // #119 — the rich server payload also carries the per-item array used by
 // the re-inspection two-column layout. Optional so the summary view (which
 // only reads totals) and non-re-inspection reports are unaffected.
 items?: ReportItem[];
 // The server names section title `title`; the summary view reads `name`.
 title?: string;
}

interface InspectorSignature {
 signatureBase64: string;
 signedAt: string | number;
 auto?: boolean;
 userId?: string;
}

// #120 — amendment trail attached by the server's getReportData. Only
// meaningful (`amended === true`) once a report has been re-published, since
// live edits never create a new version row.
interface AmendmentTrail {
 amended: boolean;
 latestVersion: number;
 versions: Array<{
  versionNumber: number;
  publishedAt: number;
  reason: string | null;
  isAmendment: boolean;
 }>;
}

// #119 — re-inspection context attached by the server's getReportData. Only
// present when the inspection is a re-inspection (sourceInspectionId set). The
// report then renders a left(original)/right(follow-up) layout per carried item.
interface ReinspectionStatus {
 key: string;
 label: string;
 closed: boolean;
}
interface Reinspection {
 round: number;
 rootInspectionId: string | null;
 statuses: ReinspectionStatus[];
}

// Photo + per-item shapes carried on the rich server payload. The summary view
// only reads section totals, but the re-inspection branch iterates the items.
interface ReportPhoto {
 key: string;
 originalKey?: string;
 url: string;
}
interface ReportItem {
 id: string;
 label: string;
 rating?: string | null;
 ratingLabel?: string | null;
 notes?: string | null;
 photos?: ReportPhoto[];
 // #119 — re-inspection passthrough (null on non-carried items).
 original?: {
  rating: string | null;
  notes: string | null;
  photos: ReportPhoto[];
 } | null;
 followupStatus?: string | null;
 followupNotes?: string | null;
}

interface ReportData {
 address: string;
 date: string | null;
 inspectorName: string;
 clientName: string | null;
 sections: ReportSection[];
 defectSummary: { safety: number; recommendation: number; maintenance: number };
 reportTheme?: string;
 inspectorSignature?: InspectorSignature | null;
 amendmentTrail?: AmendmentTrail;
 reinspection?: Reinspection | null;
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
 const privacyUrl = readLegalLinks(context)?.privacyUrl ?? null;
 try {
 const api = createApi(context);
 const token = new URL(request.url).searchParams.get("token") ?? undefined;
 const [res, brand] = await Promise.all([
 api.publicReport.report[":tenant"][":id"].$get({
 param: { tenant: params.tenant ?? "", id: params.id ?? "" },
 query: { token },
 }),
 resolveTenantBrand(context, params.tenant),
 ]);
 const body = res.ok ? ((await res.json()) as Record<string, unknown>) : {};
 const d = (body.data ?? {}) as Record<string, unknown>;
 // Extract _inspector_signature if the API embeds it in the response
 const rawSig = (d.inspectorSignature ?? d._inspector_signature) as InspectorSignature | null | undefined;
 const reportData: ReportData | null = Object.keys(d).length > 0
 ? { ...(d as unknown as ReportData), inspectorSignature: rawSig ?? null }
 : null;
 return {
 report: reportData,
 brand,
 error: res.ok ? null : "Report not found",
 privacyUrl,
 };
 } catch {
 return { report: null, brand: EMPTY_BRAND as TenantBrand, error: "Service unavailable", privacyUrl };
 }
}

export default function ReportPage() {
 const { report, brand, error, privacyUrl } = useLoaderData<typeof loader>();

 if (error || !report) {
 return (
 <div className="p-8 text-center">
 <h1 className="text-2xl font-bold">Report Not Found</h1>
 <p className="text-ih-fg-3 mt-2">
 {error ?? "This report is not available."}
 </p>
 </div>
 );
 }

 const { defectSummary: ds } = report;
 const inspectorSig = report.inspectorSignature ?? null;

 // #119 — re-inspection mode. When set, the body renders only the carried
 // items in a left(original)/right(follow-up) layout instead of the section
 // summary. Resolve the human label for a follow-up status from the tenant's
 // status catalog; fall back to the raw key when unknown.
 const reinspection = report.reinspection ?? null;
 const statusLabel = (key: string | null | undefined): string => {
  if (!key) return "Pending";
  return reinspection?.statuses.find((s) => s.key === key)?.label ?? key;
 };
 const statusIsClosed = (key: string | null | undefined): boolean =>
  !!key && (reinspection?.statuses.find((s) => s.key === key)?.closed ?? false);

 return (
 <>
 <style>{`
 @media print {
 .signature-block img { max-height: 60px; }
 .signature-block { page-break-inside: avoid; }
 }
 `}</style>
 <div className="max-w-3xl mx-auto p-6" data-theme={report.reportTheme || undefined} style={brandTokens(brand.primaryColor)}>
 {/* Header */}
 <div className="mb-8">
 {(brand.logoUrl || brand.siteName) && (
 <div className="mb-4 flex items-center gap-2.5">
 {brand.logoUrl ? (
 <img src={brand.logoUrl} alt={brand.siteName ?? "Logo"} className="h-8 w-auto" />
 ) : (
 <span className="font-serif text-[16px] font-semibold text-ih-fg-2">{brand.siteName}</span>
 )}
 </div>
 )}
 <h1 className="text-2xl font-bold">{report.address}</h1>
 <p className="text-[13px] text-ih-fg-3 mt-1">
 Inspected by {report.inspectorName}
 {report.date && <span> on {report.date}</span>}
 {report.clientName && <span> for {report.clientName}</span>}
 </p>
 </div>

 {/* #119 — re-inspection header. Gated on report.reinspection so normal
 reports are unchanged. */}
 {reinspection && (
 <header className="mb-6 rounded-lg border border-ih-info-fg/30 bg-ih-info-bg p-4">
 <h2 className="text-lg font-semibold text-ih-info-fg">Re-Inspection Report</h2>
 <p className="text-[13px] text-ih-info-fg/90 mt-0.5">
 Round {reinspection.round} — original findings vs. follow-up status
 </p>
 </header>
 )}

 {/* #120 — amendment banner. Only renders after an actual re-publish
 (versions.length > 1); live edits never create a version. Optional
 chaining keeps it safe if the payload type lags the server. */}
 {report.amendmentTrail?.amended && (
 <div className="mb-6 rounded-lg border border-ih-watch-fg/30 bg-ih-watch-bg p-3 text-[13px] text-ih-watch-fg">
 <p className="font-semibold">
 This report was amended (version {report.amendmentTrail.latestVersion}).
 </p>
 <ul className="mt-2 space-y-1">
 {report.amendmentTrail.versions.map((v) => (
 <li key={v.versionNumber}>
 v{v.versionNumber} &middot;{" "}
 {new Date(v.publishedAt * 1000).toLocaleDateString()}
 {v.reason ? ` — ${v.reason}` : ""}
 </li>
 ))}
 </ul>
 </div>
 )}

 {/* Defect summary badges */}
 <div className="flex gap-2 mb-6">
 {ds.safety > 0 && (
 <span className="text-[11px] font-bold px-2 py-1 rounded bg-ih-bad-bg text-ih-bad-fg">
 {ds.safety} Safety
 </span>
 )}
 {ds.recommendation > 0 && (
 <span className="text-[11px] font-bold px-2 py-1 rounded bg-ih-watch-bg text-ih-watch-fg">
 {ds.recommendation} Recommendation
 </span>
 )}
 {ds.maintenance > 0 && (
 <span className="text-[11px] font-bold px-2 py-1 rounded bg-ih-info-bg text-ih-info-fg">
 {ds.maintenance} Maintenance
 </span>
 )}
 </div>

 {reinspection ? (
 /* #119 — re-inspection body: only the carried items are present in the
 payload (Track B: selected items only). Each is rendered as a two-column
 row — left = original finding (grayscale photos), right = follow-up
 status badge + new notes/photos (full colour). */
 <div className="space-y-3">
 {/* R7 / Track B — render ONLY the carried items. getReportData
    builds sections[].items from the FULL template snapshot, so
    non-carried items arrive with original == null; the helper
    filters them out and drops sections left empty. */}
 {sectionsWithCarriedItems(report.sections).flatMap((section) =>
 section.items.map((item) => (
 <div
 key={item.id}
 className="rounded-lg border border-ih-border overflow-hidden"
 >
 <div className="px-4 py-2 border-b border-ih-border bg-ih-bg-muted">
 <p className="text-[13px] font-semibold">{item.label}</p>
 </div>
 <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-ih-border">
 {/* LEFT — original finding (grayscale) */}
 <div className="p-4">
 <p className="text-[11px] font-bold uppercase tracking-wide text-ih-fg-3 mb-2">
 Original Finding
 </p>
 {item.original?.rating && (
 <p className="text-[13px] font-medium">{item.original.rating}</p>
 )}
 {item.original?.notes && (
 <p className="text-[13px] text-ih-fg-2 mt-1 whitespace-pre-wrap">
 {item.original.notes}
 </p>
 )}
 {item.original?.photos && item.original.photos.length > 0 && (
 <div className="flex flex-wrap gap-2 mt-3">
 {item.original.photos.map((p) => (
 <img
 key={p.key}
 src={p.url}
 alt="Original finding"
 className="h-20 w-20 object-cover rounded border border-ih-border grayscale"
 />
 ))}
 </div>
 )}
 {!item.original?.rating && !item.original?.notes &&
 !(item.original?.photos && item.original.photos.length > 0) && (
 <p className="text-[12px] text-ih-fg-3 italic">No original detail recorded.</p>
 )}
 </div>
 {/* RIGHT — follow-up status + new evidence (colour) */}
 <div className="p-4">
 <p className="text-[11px] font-bold uppercase tracking-wide text-ih-fg-3 mb-2">
 Follow-up
 </p>
 <span
 className={`inline-block text-[11px] font-bold px-2 py-1 rounded ${
 statusIsClosed(item.followupStatus)
 ? "bg-ih-ok-bg text-ih-ok-fg"
 : "bg-ih-watch-bg text-ih-watch-fg"
 }`}
 >
 {statusLabel(item.followupStatus)}
 </span>
 {item.followupNotes && (
 <p className="text-[13px] text-ih-fg-2 mt-2 whitespace-pre-wrap">
 {item.followupNotes}
 </p>
 )}
 {item.photos && item.photos.length > 0 && (
 <div className="flex flex-wrap gap-2 mt-3">
 {item.photos.map((p) => (
 <img
 key={p.key}
 src={p.url}
 alt="Follow-up"
 className="h-20 w-20 object-cover rounded border border-ih-border"
 />
 ))}
 </div>
 )}
 </div>
 </div>
 </div>
 ))
 )}
 </div>
 ) : (
 /* Section list (summary view — unchanged) */
 <div className="space-y-2">
 {report.sections.map((section) => (
 <div
 key={section.id}
 className="flex items-center justify-between p-4 rounded-lg border border-ih-border"
 >
 <div>
 <p className="text-[13px] font-medium">{section.name}</p>
 <p className="text-[11px] text-ih-fg-3">
 {section.itemCount} items inspected
 </p>
 </div>
 {section.defects > 0 && (
 <span className="text-[11px] font-bold px-2 py-1 rounded bg-ih-watch-bg text-ih-watch-fg">
 {section.defects} defects
 </span>
 )}
 </div>
 ))}
 </div>
 )}

 {/* Inspector signature block */}
 {inspectorSig && (
 <section className="mt-12 pt-6 border-t border-ih-border signature-block">
 <h3 className="text-sm font-semibold mb-2">Signed by Inspector</h3>
 <img
 src={inspectorSig.signatureBase64}
 alt="Inspector signature"
 className="max-w-[240px] max-h-[80px] border border-ih-border bg-ih-bg-card p-1"
 />
 <p className="text-xs text-ih-fg-3 mt-1">
 {report.inspectorName || "Inspector"} &middot;{" "}
 {new Date(inspectorSig.signedAt).toUTCString()}
 {inspectorSig.auto && (
 <span className="ml-2 italic">(auto-signed at publish)</span>
 )}
 </p>
 </section>
 )}
 {privacyUrl && (
 <p className="mt-8 text-center text-xs text-ih-fg-3">
 <a href={privacyUrl} target="_blank" rel="noreferrer" className="hover:underline">Privacy Policy</a>
 </p>
 )}
 </div>
 </>
 );
}
