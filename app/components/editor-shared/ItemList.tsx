import { useState, useRef } from "react";
import { createPortal } from "react-dom";
import { Button, IconButton, MenuItem } from "@core/shared-ui";
import type { EditorMode } from "./editor-mode";
import { useSortableReorder } from "./useSortableReorder";
import { InlineRename } from "./InlineRename";
import { findingKey } from "~/hooks/findings/shared";
import type { EditorGroup } from "~/lib/editor/statutory-groups";
import { m } from "~/paraglide/messages";

// Handle + ⋯ occupy reserved flex slots so they never cover the item number,
// label, or rating dot. Desktop reveals on hover; touch always shows them.
const REVEAL = "invisible group-hover:visible focus-within:visible [@media(hover:none)]:visible";

interface SharedItemListProps {
  mode: EditorMode;
  items: Array<{ id: string; label: string; type: string }>;
  sectionId: string;
  activeItemId: string | null;
  onSelect: (id: string) => void;
  /** Live results keyed by `{unitId}:{sectionId}:{itemId}` (fill-only). */
  results?: Record<string, Record<string, unknown>>;
  /**
   * Phase U (Batch C1) — active per-unit scope for result lookups. `null`
   * (default) resolves the `_default` common scope, byte-identical to before.
   */
  activeUnitId?: string | null;
  // batch (fill-only today; reserved for author bulk later):
  batchMode?: boolean;
  batchSelected?: Record<string, boolean>;
  onBatchToggle?: (id: string) => void;
  onBatchRange?: (fromId: string, toId: string) => void;
  /** D8 structural editing — when provided, a per-item ⋯ menu + "+ Add item" render. */
  onAddItem?: () => void;
  onDuplicateItem?: (itemId: string) => void;
  onDeleteItem?: (itemId: string) => void;
  onMoveItem?: (itemId: string, dir: -1 | 1) => void;
  /** Reorder an item via drag-and-drop (drop `fromId` onto `toId`). */
  onReorderItem?: (fromId: string, toId: string) => void;
  /** Rename an item inline (double-click / F2 / ⋯ menu). */
  onRenameItem?: (itemId: string, label: string) => void;
  /**
   * Repeated blocks the authority's form prints, when this template declares one.
   *
   * Absent is the ordinary case and changes nothing -- which is what keeps the
   * template author's list and every narrative template exactly as they were.
   * Present, the run of items stops being flat: each slot is announced by the
   * name the FORM prints over it, and `+ Add item` gives way to an add that
   * knows what it is adding. A free item would reach no binding, so whatever
   * were typed into it would never arrive on the form and nothing would say so.
   */
  groups?: readonly EditorGroup[];
  /** Add another instance of a group. Called with the group's id. */
  onAddGroupInstance?: (groupId: string) => void;
}

/**
 * itemId -> the slot heading to print above it, and the group it closes.
 *
 * Position is decided by where the items SIT IN THE LIST, never by the order the
 * declaration happens to list a slot's fields. A declaration's bindings are a
 * map; their insertion order says nothing about the section. Anchoring to "the
 * slot's first field as written" puts the heading one row off, and one row off
 * is a heading that claims the panel above it is the Second one. Found in the
 * browser, not by a fixture whose bindings happened to be in a helpful order.
 */
function slotHeadings(
  groups: readonly EditorGroup[] | undefined,
  items: ReadonlyArray<{ id: string }>,
) {
  const heading = new Map<string, { slotLabel: string }>();
  const closes = new Map<string, EditorGroup>();
  const position = new Map(items.map((item, i) => [item.id, i]));
  const earliest = (ids: string[]) =>
    ids.filter((id) => position.has(id))
       .sort((a, b) => (position.get(a) as number) - (position.get(b) as number));

  for (const group of groups ?? []) {
    let lastPresent: string | null = null;
    for (const slot of group.slots) {
      const present = earliest(Object.values(slot.fields));
      if (present.length === 0) continue;
      heading.set(present[0], { slotLabel: slot.label });
      lastPresent = present[present.length - 1];
    }
    // Only the LAST printed slot closes the group: the add belongs after every
    // slot the form prints, not after each one.
    if (lastPresent) closes.set(lastPresent, group);
  }
  return { heading, closes };
}

/** Map rating to dot color for the item list */
function ratingDotClass(rating: string): string {
  if (rating === "Satisfactory" || rating === "SAT") return "bg-ih-ok";
  if (rating === "Monitor" || rating === "MON") return "bg-ih-watch";
  if (rating === "Defect" || rating === "DEF") return "bg-ih-bad";
  return "bg-ih-border-strong";
}

export function ItemList({
  mode,
  items,
  sectionId,
  activeItemId,
  onSelect,
  results,
  batchMode,
  batchSelected,
  onBatchToggle,
  onBatchRange,
  onAddItem,
  onDuplicateItem,
  onDeleteItem,
  onMoveItem,
  onReorderItem,
  onRenameItem,
  activeUnitId = null,
  groups,
  onAddGroupInstance,
}: SharedItemListProps) {
  const { heading: slotHeading, closes: groupClosedBy } = slotHeadings(groups, items);
  const grouped = Boolean(groups?.length);
  const lastClickedRef = useRef<string | null>(null);
  const [menuItemId, setMenuItemId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  // The ⋯ menu is rendered in a portal at this viewport anchor so the
  // overflow-y-auto item column never clips it (the last item's menu opens
  // downward past the scroll container's edge).
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number } | null>(null);
  const openItemMenu = (itemId: string, el: HTMLElement) => {
    if (menuItemId === itemId) { setMenuItemId(null); setMenuAnchor(null); return; }
    const r = el.getBoundingClientRect();
    setMenuItemId(itemId);
    setMenuAnchor({ x: r.right, y: r.bottom });
  };
  const closeItemMenu = () => { setMenuItemId(null); setMenuAnchor(null); };
  const structuralEditing = Boolean(onDuplicateItem || onDeleteItem || onMoveItem || onRenameItem);
  const resultsMap = results ?? {};
  // Phase U (Batch C1) — resolve a result in the active unit scope. The bare
  // `itemId` key holds only ONE unit's entry (last projected wins), so it is a
  // legitimate fallback ONLY in the common scope (`activeUnitId == null`);
  // consulting it under a real unit would shadow one unit's finding with
  // another's. Mirrors `getResult` in useFindings/useInspection.
  const scopedResult = (itemId: string): Record<string, unknown> =>
    resultsMap[findingKey(activeUnitId, sectionId, itemId)] ||
    (activeUnitId == null ? resultsMap[itemId] : undefined) ||
    {};
  // Drag-to-reorder (desktop: grab the handle; touch: 500ms long-press).
  // Available in both fill and author modes; disabled during batch-select and
  // mid-rename so those gestures aren't hijacked.
  const { containerRef } = useSortableReorder<HTMLDivElement>({
    ids: items.map((i) => i.id),
    onReorder: onReorderItem ?? (() => {}),
    disabled: !onReorderItem || Boolean(batchMode) || editingId !== null,
  });

  return (
    <div data-shortcut-scope className="w-[280px] flex-shrink-0 border-r border-ih-border overflow-y-auto flex flex-col">
      {/* Filter chips live in the inspection-edit header row (with per-filter
          counts + a working Flagged filter); this shared list only renders the
          items it is handed, already filtered by the parent. */}

      {/* Item list */}
      <div ref={containerRef} className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {items.map((item, idx) => {
          const result = scopedResult(item.id);
          const fullIdx = items.findIndex((i) => i.id === item.id);
          const editing = editingId === item.id;
          const openSlot = slotHeading.get(item.id);
          const closingGroup = groupClosedBy.get(item.id);
          return (
            <div key={`wrap-${item.id}`}>
            {openSlot && (
              <div className="px-2 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-ih-fg-3">
                {openSlot.slotLabel}
              </div>
            )}
            <div
              key={item.id}
              data-sortable-item
              data-sortable-id={item.id}
              onKeyDown={(e) => {
                if (onMoveItem && e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
                  e.preventDefault();
                  onMoveItem(item.id, e.key === "ArrowUp" ? -1 : 1);
                } else if (onRenameItem && e.key === "F2") {
                  e.preventDefault();
                  setEditingId(item.id);
                }
              }}
              className={`group relative flex items-stretch rounded-md text-[13px] transition-all ${
                activeItemId === item.id
                  ? "bg-ih-bg-card shadow-ih-card border-l-[3px] border-ih-primary font-medium"
                  : "text-ih-fg-3 hover:bg-ih-bg-muted"
              }`}
            >
              {/* Reserved drag-handle slot — own column, never covers number/label/dot.
                  Hidden in batch mode (drag is disabled while selecting). */}
              {onReorderItem && !batchMode && (
                <span
                  data-drag-handle
                  aria-label={m.editor_shared_drag_label({ label: item.label })}
                  title={m.editor_shared_drag_to_reorder()}
                  className={`shrink-0 w-5 flex items-center justify-center cursor-grab select-none text-ih-fg-4 touch-none ${REVEAL}`}
                >☰</span>
              )}

              {editing && onRenameItem ? (
                <div className="min-w-0 flex-1 flex items-center gap-2 px-2 py-2">
                  <span className="text-[10px] text-ih-fg-3 font-mono w-5 shrink-0">{String(idx + 1).padStart(2, "0")}</span>
                  <InlineRename
                    value={item.label}
                    ariaLabel={m.editor_shared_item_name_aria()}
                    onCommit={(next) => { onRenameItem(item.id, next); setEditingId(null); }}
                    onCancel={() => setEditingId(null)}
                    className="min-w-0 flex-1 bg-transparent border-b border-ih-primary outline-none text-[13px] text-ih-fg-1"
                  />
                </div>
              ) : (
                <button
                  onClick={(e) => {
                    if (batchMode && onBatchToggle) {
                      if (e.shiftKey && lastClickedRef.current && onBatchRange) {
                        onBatchRange(lastClickedRef.current, item.id);
                      } else {
                        onBatchToggle(item.id);
                      }
                      lastClickedRef.current = item.id;
                    } else {
                      onSelect(item.id);
                    }
                  }}
                  onDoubleClick={onRenameItem && !batchMode ? () => setEditingId(item.id) : undefined}
                  className={`flex-1 min-w-0 text-left py-2 flex items-center gap-2 ${onReorderItem && !batchMode ? "pr-1" : "px-3"}`}
                >
                  {batchMode && (
                    <span
                      className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center ${
                        batchSelected?.[item.id]
                          ? "bg-ih-primary border-ih-primary"
                          : "border-ih-border-strong"
                      }`}
                    >
                      {batchSelected?.[item.id] && (
                        <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </span>
                  )}
                  {/* Number, label and rating dot are ALWAYS visible. */}
                  <span className="text-[10px] text-ih-fg-3 font-mono w-5 shrink-0">
                    {String(idx + 1).padStart(2, "0")}
                  </span>
                  <span className="flex-1 truncate">{item.label}</span>
                  {mode === "fill" && Boolean(result.rating) && (
                    <span
                      className={`w-2 h-2 rounded-full flex-shrink-0 ${ratingDotClass(result.rating as string)}`}
                    />
                  )}
                  {mode === "author" && (
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-ih-bg-muted text-ih-fg-2 flex-shrink-0">
                      {item.type}
                    </span>
                  )}
                </button>
              )}

              {/* Reserved ⋯ slot — own column, never overlaps the rating dot. */}
              {structuralEditing && !batchMode && (
                <div className={`shrink-0 w-6 flex items-center justify-center ${REVEAL}`}>
                  <IconButton
                    onClick={(e) => { e.stopPropagation(); openItemMenu(item.id, e.currentTarget); }}
                    size="sm"
                    className="w-6 h-6 text-ih-fg-4 hover:text-ih-fg-2"
                    aria-label={m.editor_shared_edit_label({ label: item.label })}
                    aria-haspopup="true"
                    aria-expanded={menuItemId === item.id}
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>
                  </IconButton>
                  {menuItemId === item.id && menuAnchor && createPortal(
                    <>
                      <div className="fixed inset-0 z-[60]" onClick={closeItemMenu} />
                      <div
                        role="menu"
                        style={{ top: menuAnchor.y + 4, left: menuAnchor.x }}
                        className="fixed -translate-x-full z-[61] w-36 py-1 bg-ih-bg-card border border-ih-border rounded-md shadow-ih-popover text-[12px]"
                      >
                        {onRenameItem && (
                          <MenuItem onClick={(e) => { e.stopPropagation(); closeItemMenu(); setEditingId(item.id); }}>{m.editor_shared_menu_rename()}</MenuItem>
                        )}
                        {onDuplicateItem && (
                          <MenuItem onClick={(e) => { e.stopPropagation(); closeItemMenu(); onDuplicateItem(item.id); }}>{m.editor_shared_menu_duplicate()}</MenuItem>
                        )}
                        {onMoveItem && fullIdx > 0 && (
                          <MenuItem onClick={(e) => { e.stopPropagation(); closeItemMenu(); onMoveItem(item.id, -1); }}>{m.editor_shared_menu_move_up()}</MenuItem>
                        )}
                        {onMoveItem && fullIdx < items.length - 1 && (
                          <MenuItem onClick={(e) => { e.stopPropagation(); closeItemMenu(); onMoveItem(item.id, 1); }}>{m.editor_shared_menu_move_down()}</MenuItem>
                        )}
                        {onDeleteItem && (
                          <MenuItem tone="danger" onClick={(e) => { e.stopPropagation(); closeItemMenu(); onDeleteItem(item.id); }}>{m.common_delete()}</MenuItem>
                        )}
                      </div>
                    </>,
                    document.body,
                  )}
                </div>
              )}
            </div>
            {closingGroup && onAddGroupInstance && (
              <div className="px-2 pt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onAddGroupInstance(closingGroup.id)}
                  className="w-full h-auto py-1.5 border border-dashed border-ih-border-strong text-[12px] text-ih-fg-3 hover:bg-transparent hover:text-ih-primary-text hover:border-ih-primary"
                >
                  {m.editor_shared_add_group_instance({ group: closingGroup.label })}
                </Button>
              </div>
            )}
            </div>
          );
        })}
      </div>
      {onAddItem && !grouped && (
        <div className="p-2 border-t border-ih-border">
          <Button
            variant="ghost"
            size="sm"
            onClick={onAddItem}
            className="w-full h-auto py-2 border border-dashed border-ih-border-strong font-bold text-ih-fg-3 hover:bg-transparent hover:text-ih-primary-text hover:border-ih-primary"
          >
            {m.editor_shared_add_item()}
          </Button>
        </div>
      )}
    </div>
  );
}
