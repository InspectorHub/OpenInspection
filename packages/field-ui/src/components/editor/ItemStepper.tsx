import { Button, Icon } from "@core/shared-ui";
import { m } from "../../i18n";
import { useTextEntryActive } from "../../hooks/useTextEntryActive";
import type { ItemNeighbours } from "../../editor/item-neighbours";

/**
 * Previous and next item under the item editor on touch layouts: one tap moves on, across sections, so nobody has to go back to a
 * list or a drawer to reach the neighbour. At the first and last item of the inspection the missing side is disabled.
 */
export function ItemStepper({ neighbours, onPrev, onNext, className = "", hideWhileTyping = false }: { neighbours: ItemNeighbours; onPrev(): void; onNext(): void; className?: string; hideWhileTyping?: boolean }) {
  const { prev, next, position } = neighbours;
  // Phone bar only (`hideWhileTyping`): out of sight while a text field has focus on a touch device (see the hook), and it keeps its place, so the
  // page does not shift when it comes back. The tablet / desktop pane never hides.
  const typing = useTextEntryActive() && hideWhileTyping;
  return (
    <nav aria-label={m.editor_hud_nav_prev_next()} data-testid="item-stepper" className={`flex items-center gap-2 border-t border-ih-border bg-ih-bg-card px-3 py-2 transition-[opacity,visibility] duration-150 ${typing ? "opacity-0 invisible" : "opacity-100"} ${className}`}>
      <Button variant="secondary" onClick={onPrev} disabled={prev === null} aria-label={m.editor_hud_nav_prev()} className="min-h-11 min-w-0 flex-1 touch-manipulation" icon={<Icon name="chevL" size={16} />}>
        {m.editor_speedmode_prev()}
      </Button>
      {position && (
        <span aria-live="polite" className="min-w-[2.5rem] shrink-0 text-center text-[12px] font-semibold text-ih-fg-2">
          {m.editor_item_position({ n: position.index, total: position.total })}
        </span>
      )}
      <Button variant="secondary" onClick={onNext} disabled={next === null} aria-label={m.editor_hud_nav_next()} className="min-h-11 min-w-0 flex-1 touch-manipulation">
        {m.common_next()} <Icon name="chevR" size={16} />
      </Button>
    </nav>
  );
}
