import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, IconButton, MenuItem } from '@core/shared-ui';
import { SectionDonut } from '../editor/SectionDonut';
import { sectionIconFor } from '../editor/section-icons';
import type { EditorMode } from './editor-mode';
import { useSortableReorder } from './useSortableReorder';
import { InlineRename } from './InlineRename';
import { findingKey } from '~/hooks/findings/shared';

// Handle + ⋮ live in reserved flex slots so they never occlude the section name
// or progress donut. On desktop the glyph shows on hover; on touch (no hover) it
// is always shown. Space is reserved either way, so nothing shifts or overlaps.
const REVEAL = 'invisible group-hover:visible focus-within:visible [@media(hover:none)]:visible';

interface SharedSectionRailProps {
 mode: EditorMode;
 sections: Array<{ id: string; title: string; items: Array<{ id: string }> }>;
 activeSection: string;
 onSelect: (id: string) => void;
 results?: Record<string, Record<string, unknown>>;
 /**
  * Phase U (Batch C1) — active per-unit scope for result lookups. `null`
  * (default) resolves the `_default` common scope, byte-identical to before.
  */
 activeUnitId?: string | null;
 sectionProgress?: (sectionId: string) => { total: number; rated: number; percent: number; hasDefect: boolean };
 sectionDefectCount?: (sectionId: string) => number;
 /** Whether the report-scoped "Inspection Details" overview entry is active. */
 overviewActive?: boolean;
 /** Called when the user selects the "Inspection Details" overview entry. */
 onSelectOverview?: () => void;
 // D8 — structural-edit callbacks (optional; hidden when absent)
 /** Add a new section at the end. */
 onAddSection?: () => void;
 /** Duplicate the section with the given id. */
 onDuplicateSection?: (id: string) => void;
 /** Delete the section with the given id. */
 onDeleteSection?: (id: string) => void;
 /** Move the section in direction -1 (up) or +1 (down). */
 onMoveSection?: (id: string, dir: -1 | 1) => void;
 /** Reorder a section via drag-and-drop (drop `fromId` onto `toId`). */
 onReorderSection?: (fromId: string, toId: string) => void;
 /** Rename a section inline (double-click / F2 / ⋯ menu). */
 onRenameSection?: (id: string, title: string) => void;
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
 mode,
 sections,
 activeSection,
 onSelect,
 results,
 activeUnitId = null,
 sectionProgress,
 sectionDefectCount,
 overviewActive = false,
 onSelectOverview,
 onAddSection,
 onDuplicateSection,
 onDeleteSection,
 onMoveSection,
 onReorderSection,
 onRenameSection,
}: SharedSectionRailProps) {
 const [openMenuId, setOpenMenuId] = useState<string | null>(null);
 const [editingId, setEditingId] = useState<string | null>(null);
 // The ⋯ menu is portaled to a viewport anchor so the section rail's
 // overflow-y-auto never clips the last section's menu.
 const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number } | null>(null);
 const openSectionMenu = (sectionId: string, el: HTMLElement) => {
  if (openMenuId === sectionId) { setOpenMenuId(null); setMenuAnchor(null); return; }
  const r = el.getBoundingClientRect();
  setOpenMenuId(sectionId);
  setMenuAnchor({ x: r.right, y: r.bottom });
 };
 const closeSectionMenu = () => { setOpenMenuId(null); setMenuAnchor(null); };
 const hasStructuralOps = Boolean(onAddSection || onDuplicateSection || onDeleteSection || onMoveSection || onRenameSection);
 // Drag-to-reorder via SortableJS (desktop: grab the handle; touch: 500ms
 // long-press). Disabled mid-rename so the input isn't torn out from under you.
 const { containerRef } = useSortableReorder<HTMLDivElement>({
  ids: sections.map((s) => s.id),
  onReorder: onReorderSection ?? (() => {}),
  disabled: !onReorderSection || editingId !== null,
 });

 return (
 <aside data-shortcut-scope className="w-[200px] flex-shrink-0 border-r border-ih-border overflow-y-auto bg-ih-bg-app/50">
 <nav className="p-2 space-y-0.5">
  {/* Report-scoped overview entry — sits above section list, no progress donut */}
  {mode === 'fill' && (
  <>
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
  </>
  )}
 <div ref={containerRef} className="space-y-0.5">
 {sections.map((section, idx) => {
 // Calculate completion
 const progress = sectionProgress?.(section.id);
 const total = progress?.total ?? (section.items?.length || 0);
 const rated = progress?.rated ?? (section.items?.filter((i) => {
 // Phase U (Batch C1) — the bare `i.id` key holds only one unit's entry, so
 // it is a valid fallback ONLY in the common scope (activeUnitId == null);
 // under a real unit it would count another unit's rating as this one's.
 const r = results?.[findingKey(activeUnitId, section.id, i.id)] || (activeUnitId == null ? results?.[i.id] : undefined);
 return r?.rating;
 }).length || 0);

 const defects = sectionDefectCount?.(section.id) ?? 0;
 const hasDefect = progress?.hasDefect ?? (defects > 0);
 const unrated = total - rated;
 const tipParts = [`${rated} of ${total} rated`];
 if (unrated > 0) tipParts.push(`${unrated} unrated`);
 if (defects > 0) tipParts.push(`${defects} defect${defects > 1 ? 's' : ''}`);
 const menuOpen = openMenuId === section.id;
 const editing = editingId === section.id;

 return (
 <div
  key={section.id}
  data-sortable-item
  data-sortable-id={section.id}
  onKeyDown={(e) => {
   if (onMoveSection && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    e.preventDefault();
    onMoveSection(section.id, e.key === 'ArrowUp' ? -1 : 1);
   } else if (onRenameSection && e.key === 'F2') {
    e.preventDefault();
    setEditingId(section.id);
   }
  }}
  className={`group relative flex items-stretch rounded-md text-[13px] transition-all ${
   activeSection === section.id
    ? "bg-ih-primary-tint text-ih-primary font-bold border-l-2 border-ih-primary"
    : "text-ih-fg-3 hover:bg-ih-bg-muted"
  }`}
 >
  {/* Reserved drag-handle slot — its own column, so it never covers the name or
      donut. Grip shows on desktop hover / always on touch; touch-none lets the
      long-press drag win over scroll only while the finger is on the handle. */}
  {onReorderSection && (
   <span
    data-drag-handle
    aria-label={`Drag ${section.title}`}
    title="Drag to reorder"
    className={`shrink-0 w-5 flex items-center justify-center cursor-grab select-none text-ih-fg-4 touch-none ${REVEAL}`}
   >☰</span>
  )}

  {editing && onRenameSection ? (
   <div className={`min-w-0 flex-1 flex items-center gap-1 py-2 ${onReorderSection ? 'pr-1' : 'px-3'}`}>
    <span className="shrink-0 text-ih-fg-3">{sectionIconFor(section.title ?? section.id)}</span>
    <InlineRename
     value={section.title}
     ariaLabel="Section name"
     onCommit={(next) => { onRenameSection(section.id, next); setEditingId(null); }}
     onCancel={() => setEditingId(null)}
     className="min-w-0 flex-1 bg-transparent border-b border-ih-primary outline-none text-[13px] text-ih-fg-1"
    />
   </div>
  ) : (
   <button
    onClick={() => onSelect(section.id)}
    onDoubleClick={onRenameSection ? () => setEditingId(section.id) : undefined}
    title={`${section.title}: ${tipParts.join(', ')}`}
    className={`min-w-0 flex-1 text-left py-2 flex items-center gap-1 ${onReorderSection ? 'pr-1' : 'px-3'}`}
   >
    {/* Icon + donut are ALWAYS visible — the handle/⋮ have their own slots. */}
    <span className="shrink-0 text-ih-fg-3">{sectionIconFor(section.title ?? section.id)}</span>
    <span className="truncate flex-1">{section.title}</span>
    <span className="ml-1 shrink-0 flex items-center">
    {mode === 'fill'
     ? <SectionDonut rated={rated} total={total} hasDefect={hasDefect} />
     : <span className="text-[10px] text-ih-fg-4 font-mono">{section.items.length}</span>}
    </span>
   </button>
  )}

  {/* Reserved ⋯ slot — its own column, never overlaps the donut. */}
  {hasStructuralOps && (
  <div className={`shrink-0 w-6 flex items-center justify-center ${REVEAL}`}>
   <IconButton
   onClick={(e) => { e.stopPropagation(); openSectionMenu(section.id, e.currentTarget); }}
   size="sm"
   className="w-6 h-6 text-ih-fg-4 hover:text-ih-fg-2"
   aria-label={`Section options for ${section.title}`}
   aria-haspopup="true"
   aria-expanded={menuOpen}
   >
   <DotsIcon />
   </IconButton>
   {menuOpen && menuAnchor && createPortal(
   <>
   <div className="fixed inset-0 z-[60]" onClick={closeSectionMenu} />
   <div
    style={{ top: menuAnchor.y + 4, left: menuAnchor.x }}
    className="fixed -translate-x-full z-[61] w-36 rounded-md shadow-ih-popover bg-ih-bg-card border border-ih-border py-0.5 text-[12px]"
    role="menu"
   >
    {onRenameSection && (
    <MenuItem
     onClick={(e) => { e.stopPropagation(); closeSectionMenu(); setEditingId(section.id); }}
    >
     Rename
    </MenuItem>
    )}
    {onDuplicateSection && (
    <MenuItem
     onClick={(e) => { e.stopPropagation(); closeSectionMenu(); onDuplicateSection(section.id); }}
    >
     Duplicate
    </MenuItem>
    )}
    {onMoveSection && idx > 0 && (
    <MenuItem
     onClick={(e) => { e.stopPropagation(); closeSectionMenu(); onMoveSection(section.id, -1); }}
    >
     Move up
    </MenuItem>
    )}
    {onMoveSection && idx < sections.length - 1 && (
    <MenuItem
     onClick={(e) => { e.stopPropagation(); closeSectionMenu(); onMoveSection(section.id, 1); }}
    >
     Move down
    </MenuItem>
    )}
    {onDeleteSection && (
    <>
     <hr className="my-0.5 border-ih-border" />
     <MenuItem
     tone="danger"
     onClick={(e) => { e.stopPropagation(); closeSectionMenu(); onDeleteSection(section.id); }}
     >
     Delete
     </MenuItem>
    </>
    )}
   </div>
   </>,
   document.body,
   )}
  </div>
  )}
 </div>
 );
 })}
 </div>
 </nav>

 {/* D8 — "+ Add section" CTA at the rail bottom (only when structural ops are wired) */}
 {onAddSection && (
  <div className="p-2 pt-0">
  <Button
   variant="ghost"
   size="sm"
   onClick={onAddSection}
   data-testid="add-section-btn"
   className="w-full justify-start h-auto py-2 border border-dashed border-ih-border text-ih-fg-4 hover:bg-transparent hover:border-ih-primary hover:text-ih-primary"
  >
   + Add section
  </Button>
  </div>
 )}

 </aside>
 );
}
