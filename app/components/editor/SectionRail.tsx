import { useState } from 'react';
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
 // D8 — structural-edit callbacks (optional; hidden when absent)
 /** Add a new section at the end. */
 onAddSection?: () => void;
 /** D8 — save the current structure to the source template ('back') or a new one ('new'). */
 onSaveToTemplate?: (mode: "back" | "new") => void;
 /** Whether the inspection has a source template (enables the 'back' action). */
 canSaveBack?: boolean;
 /** Duplicate the section with the given id. */
 onDuplicateSection?: (id: string) => void;
 /** Delete the section with the given id. */
 onDeleteSection?: (id: string) => void;
 /** Move the section in direction -1 (up) or +1 (down). */
 onMoveSection?: (id: string, dir: -1 | 1) => void;
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

// Three-dot icon for the section context menu.
function DotsIcon() {
 return (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
   <circle cx="12" cy="5" r="2" />
   <circle cx="12" cy="12" r="2" />
   <circle cx="12" cy="19" r="2" />
  </svg>
 );
}

export function SectionRail({
 sections,
 activeSection,
 onSelect,
 results,
 sectionProgress,
 sectionDefectCount,
 overviewActive = false,
 onSelectOverview,
 onAddSection,
 onSaveToTemplate,
 canSaveBack,
 onDuplicateSection,
 onDeleteSection,
 onMoveSection,
}: SectionRailProps) {
 const [openMenuId, setOpenMenuId] = useState<string | null>(null);
 const hasStructuralOps = Boolean(onAddSection || onDuplicateSection || onDeleteSection || onMoveSection);

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
 {sections.map((section, idx) => {
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
 const menuOpen = openMenuId === section.id;

 return (
 <div key={section.id} className="relative group">
  <button
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
  <span className="truncate flex-1">{section.title}</span>
  <span className="ml-1 shrink-0 flex items-center">
  <SectionDonut rated={rated} total={total} hasDefect={hasDefect} />
  </span>
  </div>
  </button>

  {/* D8 — per-section ⋯ menu (only when structural ops are wired) */}
  {hasStructuralOps && (
  <div className="absolute right-1 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center">
   <button
   onClick={(e) => { e.stopPropagation(); setOpenMenuId(menuOpen ? null : section.id); }}
   className="w-6 h-6 flex items-center justify-center rounded text-ih-fg-4 hover:text-ih-fg-2 hover:bg-ih-bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ih-primary"
   aria-label={`Section options for ${section.title}`}
   aria-haspopup="true"
   aria-expanded={menuOpen}
   >
   <DotsIcon />
   </button>
   {menuOpen && (
   <div
    className="absolute right-0 top-full mt-0.5 z-40 w-36 rounded-md shadow-ih-popover bg-ih-bg-card border border-ih-border py-0.5 text-[12px]"
    role="menu"
    onMouseLeave={() => setOpenMenuId(null)}
   >
    {onDuplicateSection && (
    <button
     role="menuitem"
     className="w-full text-left px-3 py-1.5 text-ih-fg-2 hover:bg-ih-bg-muted"
     onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); onDuplicateSection(section.id); }}
    >
     Duplicate
    </button>
    )}
    {onMoveSection && idx > 0 && (
    <button
     role="menuitem"
     className="w-full text-left px-3 py-1.5 text-ih-fg-2 hover:bg-ih-bg-muted"
     onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); onMoveSection(section.id, -1); }}
    >
     Move up
    </button>
    )}
    {onMoveSection && idx < sections.length - 1 && (
    <button
     role="menuitem"
     className="w-full text-left px-3 py-1.5 text-ih-fg-2 hover:bg-ih-bg-muted"
     onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); onMoveSection(section.id, 1); }}
    >
     Move down
    </button>
    )}
    {onDeleteSection && (
    <>
     <hr className="my-0.5 border-ih-border" />
     <button
     role="menuitem"
     className="w-full text-left px-3 py-1.5 text-ih-bad hover:bg-ih-bg-muted font-bold"
     onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); onDeleteSection(section.id); }}
     >
     Delete
     </button>
    </>
    )}
   </div>
   )}
  </div>
  )}
 </div>
 );
 })}
 </nav>

 {/* D8 — "+ Add section" CTA at the rail bottom (only when structural ops are wired) */}
 {onAddSection && (
  <div className="p-2 pt-0">
  <button
   onClick={onAddSection}
   data-testid="add-section-btn"
   className="w-full text-left px-3 py-2 rounded-md text-[12px] text-ih-fg-4 border border-dashed border-ih-border hover:border-ih-primary hover:text-ih-primary transition-all"
  >
   + Add section
  </button>
  </div>
 )}

 {/* D8 — save the inspection's current structure to a template. */}
 {onSaveToTemplate && (
  <div className="p-2 pt-0 flex flex-col gap-1 border-t border-ih-border mt-1 pt-2">
  {canSaveBack && (
   <button
    onClick={() => onSaveToTemplate("back")}
    data-testid="save-template-back-btn"
    className="w-full text-left px-3 py-1.5 rounded-md text-[11px] font-bold text-ih-fg-3 hover:bg-ih-bg-muted hover:text-ih-fg-1"
   >
    Save structure → template
   </button>
  )}
  <button
   onClick={() => onSaveToTemplate("new")}
   data-testid="save-template-new-btn"
   className="w-full text-left px-3 py-1.5 rounded-md text-[11px] font-bold text-ih-fg-3 hover:bg-ih-bg-muted hover:text-ih-fg-1"
  >
   Save as new template…
  </button>
  </div>
 )}
 </aside>
 );
}
