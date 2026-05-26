import { useLoaderData } from "react-router";
import type { Route } from "./+types/report";
import { apiFetch } from "~/lib/api.server";

export function meta() {
 return [{ title: "Inspection Report - OpenInspection" }];
}

interface ReportSection {
 id: string;
 name: string;
 itemCount: number;
 defects: number;
}

interface ReportData {
 address: string;
 date: string | null;
 inspectorName: string;
 clientName: string | null;
 sections: ReportSection[];
 defectSummary: { safety: number; recommendation: number; maintenance: number };
 reportTheme?: string;
}

export async function loader({ params }: Route.LoaderArgs) {
 try {
 const res = await apiFetch(
 `/api/public/report/${params.tenant}/${params.id}`,
 );
 const body = res.ok ? ((await res.json()) as Record<string, unknown>) : {};
 const d = (body.data ?? {}) as Record<string, unknown>;
 return {
 report: (Object.keys(d).length > 0 ? d : null) as ReportData | null,
 error: res.ok ? null : "Report not found",
 };
 } catch {
 return { report: null, error: "Service unavailable" };
 }
}

export default function ReportPage() {
 const { report, error } = useLoaderData<typeof loader>();

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

 return (
 <div className="max-w-3xl mx-auto p-6" data-theme={report.reportTheme || undefined}>
 {/* Header */}
 <div className="mb-8">
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
 </div>
 );
}
