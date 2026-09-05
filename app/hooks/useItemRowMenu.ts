import { useState } from "react";

/**
 * Open/close state for one item row's `⋯` menu, and where to draw it.
 *
 * ── WHY AN ANCHOR AND NOT PLAIN ABSOLUTE POSITIONING ────────────────────────
 * The menu is rendered in a portal at a VIEWPORT anchor, because the item
 * column is `overflow-y-auto`: positioned inside it, the last row's menu opens
 * downward past the scroll container's edge and is clipped.
 *
 * ── WHY TOGGLING ON THE SAME ROW CLOSES ─────────────────────────────────────
 * The `⋯` is the only way to close the menu with the mouse without choosing
 * something; a second press on the row that opened it has to mean "never
 * mind", not "re-anchor to the same place".
 *
 * Extracted from `ItemList` so that file stays under the 400-line ceiling —
 * this is its own concern (where a popover sits), not part of rendering a list.
 */
export function useItemRowMenu() {
    const [menuItemId, setMenuItemId] = useState<string | null>(null);
    const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number } | null>(null);

    const openItemMenu = (itemId: string, el: HTMLElement) => {
        if (menuItemId === itemId) { setMenuItemId(null); setMenuAnchor(null); return; }
        const r = el.getBoundingClientRect();
        setMenuItemId(itemId);
        setMenuAnchor({ x: r.right, y: r.bottom });
    };
    const closeItemMenu = () => { setMenuItemId(null); setMenuAnchor(null); };

    return { menuItemId, menuAnchor, openItemMenu, closeItemMenu };
}
