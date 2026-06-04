import { useLoaderData } from "react-router";
import type { Route } from "./+types/report";
import { createApi } from "~/lib/api-client.server";
import { resolveTenantBrand } from "~/lib/tenant-brand.server";
import { brandTokens, EMPTY_BRAND, type TenantBrand } from "~/lib/brand";

export function meta() {
 return [{ title: "Inspection Report - OpenInspection" }];
}

interface ReportSection {
 id: string;
 name: string;
 itemCount: number;
 defects: number;
}

interface InspectorSignature {
 signatureBase64: string;
 signedAt: string | number;
 auto?: boolean;
 userId?: string;
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
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
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
 };
 } catch {
 return { report: null, brand: EMPTY_BRAND as TenantBrand, error: "Service unavailable" };
 }
}

export default function ReportPage() {
 const { report, brand, error } = useLoaderData<typeof loader>();

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
 <span className="text-[11px] font-bold px-2 py-1 rounded bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400">
 {ds.maintenance} Maintenance
 </span>
 )}
 </div>

 {/* Section list */}
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

 {/* Inspector signature block */}
 {inspectorSig && (
 <section className="mt-12 pt-6 border-t border-ih-border signature-block">
 <h3 className="text-sm font-semibold mb-2">Signed by Inspector</h3>
 <img
 src={inspectorSig.signatureBase64}
 alt="Inspector signature"
 className="max-w-[240px] max-h-[80px] border border-ih-border bg-white p-1"
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
 </div>
 </>
 );
}
