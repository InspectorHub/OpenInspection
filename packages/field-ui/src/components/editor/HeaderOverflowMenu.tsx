import { useRef, useState, type ReactNode } from "react";
import { Button, Icon, MenuItem, Popover } from "@core/shared-ui";
import { HEADER_OVERFLOW, overflowTriggerHide } from "./header-visibility";
import { useReadOnly } from "../../read-only";
import { m } from "../../i18n";

export interface HeaderOverflowMenuProps {
  /** Opens the manual sign modal. Mirrors the `xl` Sign button. */
  onSign: () => void;
  /** Advisory lifecycle move; null once the fieldwork is already complete. */
  onFinishFieldwork: (() => void) | null;
  /** Whether the finish-fieldwork request is in flight. */
  finishingFieldwork: boolean;
  /** #181 — collab-only; null when version history is unavailable. */
  onOpenVersionHistory: (() => void) | null;
  /** The theme segment control, rendered as the menu's last row. Null when the host has none. */
  themeControl: ReactNode | null;
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
 * The trigger itself is hidden from the widest pivot among the rows it holds (`overflowTriggerHide`): from there every
 * control it holds is inline again and the menu would be empty; with no row at all it is not rendered.
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
  const readOnly = useReadOnly();

  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  // Sign, finish and version history all write, so a read-only editor holds only the theme row. The trigger is there only
  // while a row it holds is hidden inline, and not at all when it holds none.
  const triggerHide = overflowTriggerHide([
    ...(readOnly ? [] : (['sign'] as const)),
    ...(onFinishFieldwork ? (['finishFieldwork'] as const) : []),
    ...(onOpenVersionHistory ? (['versionHistory'] as const) : []),
    ...(themeControl ? (['theme'] as const) : []),
  ]);
  if (triggerHide === null) return null;
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
        className={triggerHide}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h.01M12 12h.01M19 12h.01" />
        </svg>
      </Button>

      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} align="right">
        {/* Wide enough that the four-segment theme control in the last row
            breathes; the action rows above are far shorter than this. */}
        <ul role="menu" aria-label={m.editor_header_more()} className="py-1 min-w-[260px]">
          {!readOnly && <li role="none">
            <MenuItem
              data-testid="overflow-sign-btn"
              className={HEADER_OVERFLOW.sign.row}
              icon={<Icon name="edit" className="w-3.5 h-3.5" />}
              onClick={() => run(onSign)}
            >
              {m.editor_header_sign()}
            </MenuItem>
          </li>}
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
          {themeControl && (
            <li role="none" className={`${HEADER_OVERFLOW.theme.row} mt-1 border-t border-ih-border px-3 pt-2 pb-1`}>
              <div className="text-[11px] uppercase tracking-[0.1em] text-ih-fg-3 mb-1.5">{m.nav_theme_label()}</div>
              {themeControl}
            </li>
          )}
        </ul>
      </Popover>
    </>
  );
}
