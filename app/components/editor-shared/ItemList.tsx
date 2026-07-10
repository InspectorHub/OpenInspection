import { useState, useRef } from "react";
import { createPortal } from "react-dom";
import type { EditorMode } from "./editor-mode";
import { useDragReorder } from "./useDragReorder";
import { findingKey } from "~/hooks/findings/shared";

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
  activeUnitId = null,
}: SharedItemListProps) {
  const lastClickedRef = useRef<string | null>(null);
  const [menuItemId, setMenuItemId] = useState<string | null>(null);
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
  const structuralEditing = Boolean(onDuplicateItem || onDeleteItem || onMoveItem);
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
  const { dragProps } = useDragReorder({ ids: items.map((i) => i.id), onReorder: onReorderItem ?? (() => {}) });

  return (
    <div data-shortcut-scope className="w-[280px] flex-shrink-0 border-r border-ih-border overflow-y-auto flex flex-col">
      {/* Filter chips live in the inspection-edit header row (with per-filter
          counts + a working Flagged filter); this shared list only renders the
          items it is handed, already filtered by the parent. */}

      {/* Item list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {items.map((item, idx) => {
          const result = scopedResult(item.id);
          const fullIdx = items.findIndex((i) => i.id === item.id);
          return (
            <div
              key={item.id}
              className="group relative flex items-center"
              {...(mode === "author" && onReorderItem ? dragProps(item.id) : {})}
            >
              {mode === "author" && (
                <span
                  aria-label={`Drag ${item.label}`}
                  title="Drag to reorder"
                  className="cursor-grab text-ih-fg-4 px-1 select-none"
                >
                  ☰
                </span>
              )}
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
                className={`flex-1 min-w-0 text-left px-3 py-2 rounded-md text-[13px] transition-all flex items-center gap-2 ${
                  activeItemId === item.id
                    ? "bg-ih-bg-card shadow-ih-card border-l-[3px] border-ih-primary font-medium"
                    : "text-ih-fg-3 hover:bg-ih-bg-muted"
                }`}
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
                <span className="text-[10px] text-ih-fg-4 font-mono w-5">
                  {String(idx + 1).padStart(2, "0")}
                </span>
                <span className="flex-1 truncate">{item.label}</span>
                {mode === "fill" && Boolean(result.rating) && (
                  <span
                    className={`w-2 h-2 rounded-full flex-shrink-0 ${ratingDotClass(result.rating as string)}`}
                  />
                )}
                {mode === "author" && (
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-ih-bg-muted text-ih-fg-4 flex-shrink-0">
                    {item.type}
                  </span>
                )}
              </button>
              {structuralEditing && !batchMode && (
                <div className="relative flex-shrink-0">
                  <button
                    onClick={(e) => openItemMenu(item.id, e.currentTarget)}
                    className="w-7 h-7 rounded-md flex items-center justify-center text-ih-fg-4 opacity-0 group-hover:opacity-100 hover:bg-ih-bg-muted aria-expanded:opacity-100"
                    aria-label={`Edit ${item.label}`}
                    aria-expanded={menuItemId === item.id}
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>
                  </button>
                  {menuItemId === item.id && menuAnchor && createPortal(
                    <>
                      <div className="fixed inset-0 z-[60]" onClick={closeItemMenu} />
                      <div
                        role="menu"
                        style={{ top: menuAnchor.y + 4, left: menuAnchor.x }}
                        className="fixed -translate-x-full z-[61] w-36 py-1 bg-ih-bg-card border border-ih-border rounded-md shadow-ih-popover text-[12px]"
                      >
                        {onDuplicateItem && (
                          <button role="menuitem" onClick={() => { closeItemMenu(); onDuplicateItem(item.id); }} className="w-full text-left px-3 py-1.5 text-ih-fg-2 hover:bg-ih-bg-muted">Duplicate</button>
                        )}
                        {onMoveItem && fullIdx > 0 && (
                          <button role="menuitem" onClick={() => { closeItemMenu(); onMoveItem(item.id, -1); }} className="w-full text-left px-3 py-1.5 text-ih-fg-2 hover:bg-ih-bg-muted">Move up</button>
                        )}
                        {onMoveItem && fullIdx < items.length - 1 && (
                          <button role="menuitem" onClick={() => { closeItemMenu(); onMoveItem(item.id, 1); }} className="w-full text-left px-3 py-1.5 text-ih-fg-2 hover:bg-ih-bg-muted">Move down</button>
                        )}
                        {onDeleteItem && (
                          <button role="menuitem" onClick={() => { closeItemMenu(); onDeleteItem(item.id); }} className="w-full text-left px-3 py-1.5 text-ih-bad hover:bg-ih-bg-muted">Delete</button>
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
      {onAddItem && (
        <div className="p-2 border-t border-ih-border">
          <button
            onClick={onAddItem}
            className="w-full py-2 rounded-md border border-dashed border-ih-border-strong text-[12px] font-bold text-ih-fg-3 hover:text-ih-primary hover:border-ih-primary"
          >
            + Add item
          </button>
        </div>
      )}
    </div>
  );
}
