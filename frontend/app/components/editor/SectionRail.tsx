interface SectionRailProps {
 sections: Array<{ id: string; title: string; items: any[] }>;
 activeSection: string;
 onSelect: (id: string) => void;
 results: Record<string, any>;
}

export function SectionRail({ sections, activeSection, onSelect, results }: SectionRailProps) {
 return (
 <aside className="w-[200px] flex-shrink-0 border-r border-ih-border overflow-y-auto bg-ih-bg-app/50">
 <nav className="p-2 space-y-0.5">
 {sections.map((section) => {
 // Calculate completion
 const total = section.items?.length || 0;
 const rated = section.items?.filter((i: any) => {
 const r = results[`_default:${section.id}:${i.id}`] || results[i.id];
 return r?.rating;
 }).length || 0;

 return (
 <button
 key={section.id}
 onClick={() => onSelect(section.id)}
 className={`w-full text-left px-3 py-2 rounded-md text-[13px] transition-all ${
 activeSection === section.id
 ? "bg-indigo-50 text-indigo-600 font-bold border-l-2 border-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400 dark:border-indigo-400"
 : "text-ih-fg-3 hover:bg-slate-100 dark:hover:bg-slate-700/50"
 }`}
 >
 <div className="flex items-center justify-between gap-1">
 <span className="truncate">{section.title}</span>
 <span className={`text-[10px] font-mono ml-1 shrink-0 px-1.5 py-0.5 rounded ${
 rated === total && total > 0
 ? "bg-ih-ok-bg text-ih-ok-fg"
 : "bg-slate-100 text-slate-400 dark:bg-slate-700 dark:text-slate-500"
 }`}>{rated}/{total}</span>
 </div>
 </button>
 );
 })}
 </nav>
 </aside>
 );
}
