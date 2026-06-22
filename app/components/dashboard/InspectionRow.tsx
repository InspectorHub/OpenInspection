// NOTE: currently unused by routes — app/routes/dashboard.tsx has its own local InspectionRow. Kept in sync; candidates for consolidation.
import { useNavigate } from "react-router";
import { formatInspectionDateTime } from "~/lib/format-date";

interface DefectStats {
 safety: number;
 recommendation: number;
 maintenance: number;
}

interface Inspection {
 id: string;
 propertyAddress?: string;
 address?: string;
 clientName?: string;
 agentName?: string;
 inspectorName?: string;
 date?: string;
 closingDate?: string;
 referenceNumber?: string;
 referralSource?: string;
 yearBuilt?: number;
 sqft?: number;
 price?: number;
 status?: string;
 siblingCount?: number;
 defectStats?: DefectStats;
}

interface InspectionRowProps {
 inspection: Inspection;
 visibleColumns?: Set<string>;
}

function isVisible(columns: Set<string> | undefined, id: string): boolean {
 return !columns || columns.has(id);
}

function ClosingDateBadge({ closingDate }: { closingDate: string }) {
 const days = Math.round((new Date(closingDate).getTime() - Date.now()) / 86400000);
 if (days > 7) {
 return <span> · <span className="text-ih-fg-4">closes</span> {formatInspectionDateTime(closingDate)}</span>;
 }
 const tone = days <= 0 ? "late" : days <= 3 ? "rush" : "watch";
 const label = tone === "late" ? "Overdue" : tone === "rush" ? `Due ${days}d` : `Closes ${days}d`;
 const cls = tone === "watch"
 ? "bg-ih-watch-bg text-ih-watch-fg"
 : "bg-ih-bad-bg text-ih-bad-fg";
 return (
 <span> · <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-extrabold uppercase tracking-wide ${cls}`}>
 <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden="true"><circle cx={12} cy={12} r={10} /><path d="M12 6v6l4 2" /></svg>
 {label}
 </span></span>
 );
}

export function InspectionRow({ inspection: i, visibleColumns }: InspectionRowProps) {
 const navigate = useNavigate();
 const cols = visibleColumns;

 const hasDefects = i.defectStats && (i.defectStats.safety + i.defectStats.recommendation + i.defectStats.maintenance) > 0;

 return (
 <div className="px-5 py-[13px] border-t border-ih-border flex items-center gap-3 flex-wrap sm:flex-nowrap" data-test="inspection-row">
 {/* Address + metadata — clickable */}
 <button
 type="button"
 onClick={() => navigate(`/inspections/${i.id}/edit`)}
 className="flex-1 min-w-0 text-left"
 >
 <p className="font-bold text-ih-fg-1 truncate text-[14px]">
 {i.propertyAddress || i.address || "(no address)"}
 </p>
 <p className="text-[11px] text-ih-fg-3 mt-0.5">
 {isVisible(cols, "clientName") && <span>{i.clientName || "---"}</span>}
 {isVisible(cols, "agent") && i.agentName && <span> · <span className="text-ih-fg-4">via</span> {i.agentName}</span>}
 {i.siblingCount != null && i.siblingCount > 1 && (
 <span> · <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-ih-primary-tint text-ih-primary text-[10px] font-bold ring-1 ring-inset ring-ih-primary-tint">{i.siblingCount} inspections</span></span>
 )}
 {isVisible(cols, "date") && <span> · {formatInspectionDateTime(i.date)}</span>}
 {isVisible(cols, "inspector") && i.inspectorName && <span> · <span className="text-ih-fg-4">by</span> {i.inspectorName}</span>}
 {isVisible(cols, "closingDate") && i.closingDate && <ClosingDateBadge closingDate={i.closingDate} />}
 {isVisible(cols, "referenceNumber") && i.referenceNumber && <span> · <span className="text-ih-fg-4">#</span><span className="font-mono">{i.referenceNumber}</span></span>}
 {isVisible(cols, "referralSource") && i.referralSource && <span> · <span className="text-ih-fg-4">via</span> {i.referralSource}</span>}
 {isVisible(cols, "propertyFacts") && (i.yearBuilt || i.sqft) && (
 <span className="text-ih-fg-4">
 {i.yearBuilt && <span> · YB {i.yearBuilt}</span>}
 {i.sqft && <span> · {i.sqft} sqft</span>}
 </span>
 )}
 </p>

 {/* Defect chips */}
 {isVisible(cols, "defectChips") && hasDefects && (
 <div className="mt-1 flex items-center gap-1.5">
 {i.defectStats!.safety > 0 && <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold rounded bg-ih-bad-bg text-ih-bad-fg">{i.defectStats!.safety} safety</span>}
 {i.defectStats!.recommendation > 0 && <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold rounded bg-ih-watch-bg text-ih-watch-fg">{i.defectStats!.recommendation} rec</span>}
 {i.defectStats!.maintenance > 0 && <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold rounded bg-ih-info-bg text-ih-info-fg">{i.defectStats!.maintenance} maint</span>}
 </div>
 )}
 </button>

 {/* Price */}
 {isVisible(cols, "price") && i.price != null && i.price > 0 && (
 <div className="text-[12px] font-mono font-semibold text-ih-fg-3 tabular-nums">
 ${Math.round(i.price / 100)}
 </div>
 )}
 </div>
 );
}
