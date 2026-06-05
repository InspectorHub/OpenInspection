import { SectionDonut } from './SectionDonut';

interface SectionRailProps {
 sections: Array<{ id: string; title: string; items: Array<{ id: string }> }>;
 activeSection: string;
 onSelect: (id: string) => void;
 results: Record<string, Record<string, unknown>>;
 sectionProgress?: (sectionId: string) => { total: number; rated: number; percent: number; hasDefect: boolean };
 sectionDefectCount?: (sectionId: string) => number;
}

export function SectionRail({ sections, activeSection, onSelect, results, sectionProgress, sectionDefectCount }: SectionRailProps) {
 return (
 <aside data-shortcut-scope className="w-[200px] flex-shrink-0 border-r border-ih-border overflow-y-auto bg-ih-bg-app/50">
 <nav className="p-2 space-y-0.5">
 {sections.map((section) => {
 // Calculate completion
 const progress = sectionProgress?.(section.id);
 const total = progress?.total ?? (section.items?.length || 0);
 const rated = progress?.rated ?? (section.items?.filter((i) => {
 const r = results[`_default:${section.id}:${i.id}`] || results[i.id];
 return r?.rating;
 }).length || 0);

 const defects = sectionDefectCount?.(section.id) ?? 0;
 const hasDefect = progress?.hasDefect ?? (defects > 0);
 const unrated = total - rated;
 const tipParts = [`${rated} of ${total} rated`];
 if (unrated > 0) tipParts.push(`${unrated} unrated`);
 if (defects > 0) tipParts.push(`${defects} defect${defects > 1 ? 's' : ''}`);

 return (
 <button
 key={section.id}
 onClick={() => onSelect(section.id)}
 title={`${section.title}: ${tipParts.join(', ')}`}
 className={`w-full text-left px-3 py-2 rounded-md text-[13px] transition-all ${
 activeSection === section.id
 ? "bg-ih-primary-tint text-ih-primary font-bold border-l-2 border-ih-primary"
 : "text-ih-fg-3 hover:bg-ih-bg-muted"
 }`}
 >
 <div className="flex items-center justify-between gap-1">
 <span className="truncate">{section.title}</span>
 <span className="ml-1 shrink-0 flex items-center">
 <SectionDonut rated={rated} total={total} hasDefect={hasDefect} />
 </span>
 </div>
 </button>
 );
 })}
 </nav>
 </aside>
 );
}
