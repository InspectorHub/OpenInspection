import type { ReactNode } from "react";

export interface TabletTreeProps {
  /** The top bar. */
  appBar: ReactNode;
  /** Everything mounted once per tree: file inputs, overlays, drawers, the unsaved guard, the finish dialogs. */
  overlays: ReactNode;
  /** The item filter chips and the Speed rate button, above the list. */
  listHeader: ReactNode;
  /** The current section's title, pinned above the list. */
  sectionTitle: string;
  /** The item list, built to fill this pane. */
  list: ReactNode;
  /** The right pane: the item editor, the inspection overview or the empty state. */
  main: ReactNode;
  /** Shown instead of both panes when the inspection has no sections yet. */
  emptyTemplate: ReactNode;
  /** The tools dock FAB. */
  tools: ReactNode;
  /** The batch action bar, when items are selected. */
  batchBar: ReactNode;
  /** The connection status and presence strip along the bottom edge (fixed; the frame leaves room for it). */
  footer: ReactNode;
  /** Whether the results document has synced with the server; exposed so a test can wait for it. */
  collabSynced: boolean;
}

/**
 * The tablet layout (768-1023): a top bar over two panes, the item list on the left and the item editor on the
 * right, each scrolling on its own. The tree is only the frame: `FieldEditor` owns all state and hands in the
 * elements, so a rotation across a breakpoint keeps the open item and every overlay.
 *
 * Frame rules: the page is one dynamic-viewport-high column that never scrolls; both panes are `min-w-0` so a long
 * label truncates instead of widening the page; the list pane is a clamp (288px at 768, 300px at 834, 360px cap).
 */
export function TabletTree({ appBar, overlays, listHeader, sectionTitle, list, main, emptyTemplate, tools, batchBar, footer, collabSynced }: TabletTreeProps) {
  return (
    <div data-layout="tablet" data-collab-synced={collabSynced ? "true" : "false"} className="flex flex-col h-dvh min-w-0 bg-ih-bg-card overflow-hidden pb-9">
      {overlays}
      {appBar}
      {emptyTemplate ? (
        <div className="flex-1 min-h-0 flex">{emptyTemplate}</div>
      ) : (
        <div className="flex flex-1 min-h-0 min-w-0">
          <aside
            data-testid="tablet-list-pane"
            className="w-[clamp(280px,36vw,360px)] shrink-0 min-w-0 min-h-0 border-r border-ih-border flex flex-col"
          >
            {listHeader}
            <div className="sticky top-0 z-10 shrink-0 px-3 py-1.5 bg-ih-bg-card border-b border-ih-border text-[12px] font-bold text-ih-fg-2 truncate">
              {sectionTitle}
            </div>
            {list}
          </aside>
          <main
            data-testid="tablet-editor-pane"
            className="flex-1 min-w-0 min-h-0 overflow-y-auto overscroll-contain px-5 py-4 pb-24 [@media(max-height:499px)]:py-2"
          >
            {main}
          </main>
        </div>
      )}
      {/* The bar is one row of controls: it scrolls inside its own strip rather than widening the page. */}
      {batchBar && <div className="shrink-0 min-w-0 overflow-x-auto">{batchBar}</div>}
      {footer}
      {tools}
    </div>
  );
}
