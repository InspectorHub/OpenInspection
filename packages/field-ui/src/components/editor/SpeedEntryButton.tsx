import { Button } from "@core/shared-ui";
import { m } from "../../i18n";

export interface SpeedEntryButtonProps {
  /** Items left to rate across the whole inspection. */
  unrated: number;
  onOpen: () => void;
  className?: string;
}

/**
 * The touch entry into Speed mode (a phone or tablet has no `Z` key): "Speed rate · N unrated". Left out when there
 * is nothing to rate, since Speed mode would refuse to open. It needs no optional host capability.
 */
export function SpeedEntryButton({ unrated, onOpen, className = "" }: SpeedEntryButtonProps) {
  if (unrated <= 0) return null;
  return (
    <Button
      variant="secondary"
      size="sm"
      data-testid="speed-entry"
      className={`min-h-11 touch-manipulation ${className}`.trim()}
      onClick={onOpen}
    >
      {m.editor_speed_rate_unrated({ count: unrated })}
    </Button>
  );
}
