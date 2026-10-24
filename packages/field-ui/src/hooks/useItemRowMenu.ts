import { useState } from "react";

/**
 * Open/close state for one item row's `⋯` menu.
 *
 * The menu itself is a shared Popover (portaled into document.body, positioned
 * against the `⋯` button), so this hook holds only which row's menu is open.
 *
 * ── WHY TOGGLING ON THE SAME ROW CLOSES ─────────────────────────────────────
 * The `⋯` is the only way to close the menu with the mouse without choosing
 * something; a second press on the row that opened it has to mean "never
 * mind", not "re-anchor to the same place".
 *
 * Extracted from `ItemList` so that file stays under the 400-line ceiling —
 * this is its own concern (which row's menu is open), not part of rendering a list.
 */
export function useItemRowMenu() {
    const [menuItemId, setMenuItemId] = useState<string | null>(null);

    const openItemMenu = (itemId: string) => {
        setMenuItemId((current) => (current === itemId ? null : itemId));
    };
    const closeItemMenu = () => { setMenuItemId(null); };

    return { menuItemId, openItemMenu, closeItemMenu };
}
