import { SectionDonut } from './SectionDonut';
import { sectionIconFor } from './section-icons';

interface SectionRailProps {
 sections: Array<{ id: string; title: string; items: Array<{ id: string }> }>;
 activeSection: string;
 onSelect: (id: string) => void;
 results: Record<string, Record<string, unknown>>;
 sectionProgress?: (sectionId: string) => { total: number; rated: number; percent: number; hasDefect: boolean };
 sectionDefectCount?: (sectionId: string) => number;
 /** Whether the report-scoped "Inspection Details" overview entry is active. */
 overviewActive?: boolean;
 /** Called when the user selects the "Inspection Details" overview entry. */
 onSelectOverview?: () => void;
}

/** Clipboard / info glyph for the overview entry (no progress donut). */
function OverviewIcon() {
 return (
  <svg
   width="14"
   height="14"
   viewBox="0 0 24 24"
   fill="none"
   stroke="currentColor"
   strokeWidth="2"
   strokeLinecap="round"
   strokeLinejoin="round"
   aria-hidden="true"
   data-icon="overview"
  >
   <rect x="9" y="2" width="6" height="4" rx="1" />
   <path d="M5 4h-1a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-1" />
   <line x1="9" y1="12" x2="15" y2="12" />
   <line x1="9" y1="16" x2="13" y2="16" />
  </svg>
 );
}

export function SectionRail({ sections, activeSection, onSelect, results, sectionProgress, sectionDefectCount, overviewActive = false, onSelectOverview }: SectionRailProps) {
 return (
 <aside data-shortcut-scope className="w-[200px] flex-shrink-0 border-r border-ih-border overflow-y-auto bg-ih-bg-app/50">
 <nav className="p-2 space-y-0.5">
  {/* Report-scoped overview entry — sits above section list, no progress donut */}
  <button
   data-testid="inspection-details-entry"
   aria-current={overviewActive ? "true" : undefined}
   onClick={onSelectOverview}
   title="Inspection Details"
   className={`w-full text-left px-3 py-2 rounded-md text-[13px] transition-all ${
    overviewActive
     ? "bg-ih-primary-tint text-ih-primary font-bold border-l-2 border-ih-primary"
     : "text-ih-fg-3 hover:bg-ih-bg-muted"
   }`}
  >
   <div className="flex items-center gap-1">
    <span className="mr-1 shrink-0 text-ih-fg-3"><OverviewIcon /></span>
    <span className="truncate">Inspection Details</span>
   </div>
  </button>
  <hr className="my-1 border-ih-border" />
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
 <span className="mr-1 shrink-0 text-ih-fg-3">{sectionIconFor(section.title ?? section.id)}</span>
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
