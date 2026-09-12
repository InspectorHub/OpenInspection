/**
 * The editing pane before an item is open (walkthrough finding F12).
 *
 * This pane used to read "Select an item from the list to start editing / Press
 * j / k to navigate" and nothing else: it named no action, and the one thing it
 * did name — two keys — is what a first-time inspector needs least. The item
 * list is already on screen, so the pane can simply OFFER the item that comes
 * next rather than describing how to reach it.
 *
 * Three states, and the difference matters because two of them have an item to
 * open and one genuinely does not:
 *   - something unrated in this section → offer it by name (the normal case);
 *   - everything rated → offer the first item for review, and say why the
 *     heading changed, so the button is never a lie about what is left;
 *   - no items at all → say THAT, and point at "+ Add item" in the list. No
 *     button here: a control that cannot do anything is worse than prose.
 *
 * The keyboard hint survives in the first two states, demoted below the action.
 */

import { EmptyState, Button, Icon } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

export interface ItemPaneItem {
  id: string;
  label: string;
}

/**
 * Which item the pane offers to open, and whether that item is still unrated.
 *
 * Exported because the choice — first UNRATED, not simply first — is the
 * behavior worth a test of its own, independent of how it is rendered.
 * `null` means the section has no items, which is the one case with nothing to
 * offer.
 */
export function firstItemToOpen(
  items: ItemPaneItem[],
  isRated: (itemId: string) => boolean,
): { item: ItemPaneItem; unrated: boolean } | null {
  if (items.length === 0) return null;
  const unrated = items.find((it) => !isRated(it.id));
  return unrated
    ? { item: unrated, unrated: true }
    : { item: items[0], unrated: false };
}

export interface ItemPaneEmptyStateProps {
  /** The current section's items, in display order. */
  items: ItemPaneItem[];
  /** Does this item already carry a rating? */
  isRated: (itemId: string) => boolean;
  /** Open the item in the pane (same effect as clicking it in the item list). */
  onOpenItem: (itemId: string) => void;
}

export function ItemPaneEmptyState({ items, isRated, onOpenItem }: ItemPaneEmptyStateProps) {
  const next = firstItemToOpen(items, isRated);

  if (!next) {
    return (
      <div className="flex items-center justify-center h-full">
        <EmptyState
          icon={<Icon name="plus" size={32} />}
          title={m.editor_pane_no_items_title()}
          description={m.editor_pane_no_items_desc()}
        />
      </div>
    );
  }

  const unratedCount = items.filter((it) => !isRated(it.id)).length;

  return (
    <div className="flex items-center justify-center h-full">
      <EmptyState
        icon={<Icon name={next.unrated ? "edit" : "check"} size={32} />}
        title={next.unrated ? m.editor_pane_start_title() : m.editor_pane_all_rated_title()}
        description={
          next.unrated
            ? m.editor_pane_start_desc({ unrated: unratedCount, s: unratedCount === 1 ? "" : "s" })
            : m.editor_pane_all_rated_desc()
        }
        action={
          <div className="flex flex-col items-center gap-3">
            <Button
              variant="primary"
              size="sm"
              icon={<Icon name="arrowR" size={14} />}
              onClick={() => onOpenItem(next.item.id)}
            >
              {m.editor_pane_open_item({ label: next.item.label })}
            </Button>
            {/* Demoted, not deleted: useful once you know the pane, useless as a
                headline. */}
            <p className="text-[11px] text-ih-fg-3">
              {m.editor_route_navigate_hint_press()}{" "}
              <kbd className="px-1.5 py-0.5 bg-ih-bg-muted rounded text-[10px] font-mono border">J</kbd> /{" "}
              <kbd className="px-1.5 py-0.5 bg-ih-bg-muted rounded text-[10px] font-mono border">K</kbd>{" "}
              {m.editor_route_navigate_hint_navigate()}
            </p>
          </div>
        }
      />
    </div>
  );
}
