import { useState, useMemo } from "react";
import { TabStrip } from "@core/shared-ui";

const RATINGS = [
 {
 id: "SAT",
 label: "Sat",
 full: "Satisfactory",
 active: "bg-emerald-100 text-ih-ok-fg ring-2 ring-emerald-400 dark:bg-emerald-900/30",
 },
 {
 id: "MON",
 label: "Mon",
 full: "Monitor",
 active: "bg-amber-100 text-ih-watch-fg ring-2 ring-amber-400 dark:bg-amber-900/30",
 },
 {
 id: "DEF",
 label: "Def",
 full: "Defect",
 active: "bg-rose-100 text-ih-bad-fg ring-2 ring-rose-400 dark:bg-rose-900/30",
 },
 {
 id: "NI",
 label: "N/I",
 full: "Not Inspected",
 active: "bg-slate-200 text-slate-700 ring-2 ring-slate-400 dark:bg-slate-600/30 dark:text-slate-300",
 },
 {
 id: "NP",
 label: "N/P",
 full: "Not Present",
 active: "bg-slate-200 text-slate-700 ring-2 ring-slate-400 dark:bg-slate-600/30 dark:text-slate-300",
 },
] as const;

/* ------------------------------------------------------------------ */
/* Canned comment types */
/* ------------------------------------------------------------------ */

interface CannedInfoComment {
 id: string;
 title: string;
 comment: string;
 default: boolean;
}

interface CannedDefect {
 id: string;
 title: string;
 category: string;
 location: string;
 comment: string;
 photos: string[];
 default: boolean;
}

interface ItemTabs {
 information?: CannedInfoComment[];
 limitations?: CannedInfoComment[];
 defects?: CannedDefect[];
}

type CannedTabId = "information" | "limitations" | "defects";

const CANNED_TABS: Array<{ id: CannedTabId; label: string }> = [
 { id: "information", label: "Information" },
 { id: "limitations", label: "Limitations" },
 { id: "defects", label: "Defects" },
];

/* ------------------------------------------------------------------ */
/* Props */
/* ------------------------------------------------------------------ */

interface ItemEditorProps {
 item: { id: string; label: string; type: string; tabs?: unknown } | undefined;
 sectionTitle: string | undefined;
 result: Record<string, unknown>;
 onRating: (rating: string) => void;
 onNotes: (notes: string) => void;
 onNotesBlur: (notes: string) => void;
 onToggleCanned?: (tabName: string, cannedId: string, included: boolean) => void;
}

/* ------------------------------------------------------------------ */
/* Component */
/* ------------------------------------------------------------------ */

export function ItemEditor({ item, sectionTitle, result, onRating, onNotes, onNotesBlur, onToggleCanned }: ItemEditorProps) {
 const [activeTab, setActiveTab] = useState<CannedTabId>("information");

 if (!item) return null;

 const tabs = (item.tabs || {}) as ItemTabs;
 const hasTabs = item.type === "rich" && tabs && (
 (tabs.information && tabs.information.length > 0) ||
 (tabs.limitations && tabs.limitations.length > 0) ||
 (tabs.defects && tabs.defects.length > 0)
 );

 // Build a set of included canned IDs from the result state.
 // The result may store canned state as `result.tabs[tabName]` (array of { cannedId, included }).
 const getIncludedSet = (tabName: CannedTabId): Set<string> => {
 const included = new Set<string>();
 const templateEntries = (tabs[tabName] || []) as Array<{ id: string; default: boolean }>;
 const stateEntries = ((result.tabs as Record<string, Array<{ cannedId: string; included: boolean }>> | undefined)?.[tabName]) || [];
 const stateMap = new Map<string, boolean>();
 for (const s of stateEntries) {
 stateMap.set(s.cannedId, s.included);
 }
 for (const entry of templateEntries) {
 const stateVal = stateMap.get(entry.id);
 // If there is a state override, use it; otherwise use the template default
 const isIncluded = stateVal !== undefined ? stateVal : entry.default;
 if (isIncluded) included.add(entry.id);
 }
 return included;
 };

 const currentTabEntries = (tabs[activeTab] || []) as Array<CannedInfoComment | CannedDefect>;
 const includedSet = getIncludedSet(activeTab);

 // Count included per tab for badge
 const countIncluded = (tabName: CannedTabId): number => {
 return getIncludedSet(tabName).size;
 };

 // Build visible tabs for shared TabStrip (only tabs with entries)
 const visibleTabs = useMemo(() =>
 CANNED_TABS
  .filter((tab) => ((tabs[tab.id] || []) as unknown[]).length > 0)
  .map((tab) => ({ id: tab.id, label: tab.label, count: countIncluded(tab.id) || undefined })),
 [tabs, result]);

 return (
 <div className="max-w-2xl space-y-6">
 {/* Eyebrow + title */}
 <div>
 <div className="text-[11px] text-indigo-600 font-bold uppercase tracking-wide">
 {sectionTitle}
 </div>
 <h2 className="text-[19px] font-bold mt-1">{item.label}</h2>
 </div>

 {/* Rating buttons */}
 {item.type === "rich" && (
 <div className="flex gap-2">
 {RATINGS.map((r, idx) => (
 <button
 key={r.id}
 onClick={() => onRating(r.id)}
 title={`${r.full} (${idx + 1})`}
 className={`flex-1 h-[52px] rounded-lg text-[13px] font-bold transition-all ${
 result.rating === r.id
 ? r.active
 : "bg-ih-bg-muted text-ih-fg-3 hover:bg-slate-200 dark:hover:bg-slate-600"
 }`}
 >
 {r.label}
 <span className="block text-[9px] font-mono opacity-50 mt-0.5">{idx + 1}</span>
 </button>
 ))}
 </div>
 )}

 {/* Notes textarea with character count */}
 <div>
 <div className="flex items-center justify-between mb-1">
 <label className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
 Notes
 </label>
 <span className={`text-[10px] font-mono tabular-nums ${
 ((result.notes as string) || "").length > 2000
 ? "text-ih-bad"
 : "text-slate-400"
 }`}>
 {((result.notes as string) || "").length} chars
 </span>
 </div>
 <textarea
 value={(result.notes as string) || ""}
 onChange={(e) => onNotes(e.target.value)}
 onBlur={(e) => onNotesBlur(e.target.value)}
 placeholder="Add notes — type / for snippets"
 className="w-full h-28 px-3 py-2 rounded-lg border border-ih-border bg-ih-bg-card text-[13px] resize-none focus:shadow-ih-focus focus:border-indigo-500 outline-none"
 />
 </div>

 {/* Canned comments tabs */}
 {hasTabs && (
 <div>
 {/* Tab strip (shared Design System component) */}
 <div className="mb-3">
 <TabStrip
  tabs={visibleTabs}
  activeId={activeTab}
  onChange={(id) => setActiveTab(id as CannedTabId)}
 />
 </div>

 {/* Tab content: list of canned comments with toggles */}
 <div className="space-y-1.5">
 {currentTabEntries.length === 0 ? (
 <p className="text-[13px] text-ih-fg-3 text-center py-8">No pre-built comments for this tab.</p>
 ) : (
 currentTabEntries.map((entry) => {
 const isIncluded = includedSet.has(entry.id);
 return (
 <label
 key={entry.id}
 className={`flex items-start gap-2.5 p-2.5 rounded-lg cursor-pointer transition-colors ${
 isIncluded
 ? "bg-ih-primary-tint ring-1 ring-indigo-200 dark:ring-indigo-700"
 : "bg-ih-bg-app/50 hover:bg-slate-100 dark:hover:bg-slate-800"
 }`}
 >
 <input
 type="checkbox"
 checked={isIncluded}
 onChange={() => {
 onToggleCanned?.(activeTab, entry.id, !isIncluded);
 }}
 className="mt-0.5 w-4 h-4 rounded border-ih-border-strong text-indigo-600 focus:ring-indigo-500/30"
 />
 <div className="flex-1 min-w-0">
 <div className="text-[12px] font-bold text-ih-fg-2">
 {entry.title}
 {"category" in entry && (entry as CannedDefect).category && (
 <span className={`ml-1.5 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${
 (entry as CannedDefect).category === "safety"
 ? "bg-rose-100 text-ih-bad-fg dark:bg-rose-900/30"
 : (entry as CannedDefect).category === "recommendation"
 ? "bg-amber-100 text-ih-watch-fg dark:bg-amber-900/30"
 : "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
 }`}>
 {(entry as CannedDefect).category}
 </span>
 )}
 </div>
 <p className={`text-[11px] mt-0.5 leading-relaxed ${
 isIncluded ? "text-ih-fg-3" : "text-ih-fg-4"
 }`}>
 {entry.comment}
 </p>
 </div>
 </label>
 );
 })
 )}
 </div>
 </div>
 )}

 {/* Photo strip with count badge */}
 <div>
 <div className="flex items-center justify-between mb-1">
 <label className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
 Photos
 </label>
 {((result.photos as unknown[]) || []).length > 0 && (
 <span className="inline-flex items-center gap-1 text-[10px] font-bold text-ih-primary bg-ih-primary-tint px-1.5 py-0.5 rounded">
 <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
 </svg>
 {((result.photos as unknown[]) || []).length}
 </span>
 )}
 </div>
 <div className="flex items-center gap-2">
 <button className="w-16 h-16 rounded-lg border-2 border-dashed border-ih-border flex items-center justify-center text-slate-400 hover:border-indigo-400 hover:text-indigo-500 transition-colors">
 <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
 </svg>
 </button>
 <span className="text-[11px] text-slate-400">
 {((result.photos as unknown[]) || []).length === 0
 ? "No photos yet"
 : `${((result.photos as unknown[]) || []).length} photo${((result.photos as unknown[]) || []).length === 1 ? "" : "s"}`}
 </span>
 </div>
 </div>
 </div>
 );
}
