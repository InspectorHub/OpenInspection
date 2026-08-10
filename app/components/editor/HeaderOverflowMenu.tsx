import { useRef, useState, type ReactNode } from "react";
import { Button, Icon, MenuItem, Popover } from "@core/shared-ui";
import { HEADER_OVERFLOW } from "~/components/editor/header-visibility";
import { m } from "~/paraglide/messages";

export interface HeaderOverflowMenuProps {
  /** Opens the manual sign modal. Mirrors the `xl` Sign button. */
  onSign: () => void;
  /** Advisory lifecycle move; null once the fieldwork is already complete. */
  onFinishFieldwork: (() => void) | null;
  /** Whether the finish-fieldwork request is in flight. */
  finishingFieldwork: boolean;
  /** #181 — collab-only; null when version history is unavailable. */
  onOpenVersionHistory: (() => void) | null;
  /** The theme segment control, rendered as the menu's last row. */
  themeControl: ReactNode;
}

/**
 * "More" — the header's overflow, holding exactly the controls the current
 * viewport width has dropped.
 *
 * Membership is decided in CSS, not by measurement: every row carries the
 * inverse of its button's visibility class (`xl:hidden` mirrors
 * `hidden xl:inline-flex`), so a control is in exactly one place at every
 * width and neither list can drift from the other. A ResizeObserver-driven
 * "priority+" bar would be the textbook answer, but it renders nothing useful
 * during SSR and costs bundle this Worker does not have.
 *
 * The trigger itself is `xl:hidden`: Sign, version history and the theme
 * control all reappear at `xl`, so at that width the menu would be empty.
 */
export function HeaderOverflowMenu({
  onSign,
  onFinishFieldwork,
  finishingFieldwork,
  onOpenVersionHistory,
  themeControl,
}: HeaderOverflowMenuProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);

  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <>
      <Button
        ref={anchorRef}
        variant="secondary"
        size="md"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={m.editor_header_more()}
        title={m.editor_header_more()}
        className="xl:hidden"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h.01M12 12h.01M19 12h.01" />
        </svg>
      </Button>

      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} align="right">
        {/* Wide enough that the four-segment theme control in the last row
            breathes; the action rows above are far shorter than this. */}
        <ul role="menu" aria-label={m.editor_header_more()} className="py-1 min-w-[260px]">
          <li role="none">
            <MenuItem
              data-testid="overflow-sign-btn"
              className={HEADER_OVERFLOW.sign.row}
              icon={<Icon name="edit" className="w-3.5 h-3.5" />}
              onClick={() => run(onSign)}
            >
              {m.editor_header_sign()}
            </MenuItem>
          </li>
          {onFinishFieldwork && (
            <li role="none">
              <MenuItem
                data-testid="overflow-finish-fieldwork-btn"
                className={HEADER_OVERFLOW.finishFieldwork.row}
                icon={<Icon name="check" className="w-3.5 h-3.5" />}
                disabled={finishingFieldwork}
                onClick={() => run(onFinishFieldwork)}
              >
                {finishingFieldwork ? m.editor_finish_fieldwork_pending() : m.editor_finish_fieldwork()}
              </MenuItem>
            </li>
          )}
          {onOpenVersionHistory && (
            <li role="none">
              <MenuItem
                data-testid="overflow-version-history-btn"
                className={HEADER_OVERFLOW.versionHistory.row}
                icon={
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                }
                onClick={() => run(onOpenVersionHistory)}
              >
                {m.editor_header_version_history()}
              </MenuItem>
            </li>
          )}
          <li role="none" className={`${HEADER_OVERFLOW.theme.row} mt-1 border-t border-ih-border px-3 pt-2 pb-1`}>
            <div className="text-[11px] uppercase tracking-[0.1em] text-ih-fg-3 mb-1.5">{m.nav_theme_label()}</div>
            {themeControl}
          </li>
        </ul>
      </Popover>
    </>
  );
}
