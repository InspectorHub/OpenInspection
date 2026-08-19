/**
 * <NoticeBell> — the one entry point rule, made concrete (design §3.15).
 *
 * > A bell in the page header is always "sent to me". A navigation item is
 * > always a place I go on purpose.
 *
 * So Notices is a bell on every surface, never a tab: a client typically has
 * one inspection, and a ninth Hub tab would dilute the eight that carry the
 * actual work. The bell degrades to nothing when there is nothing — no badge,
 * and an empty panel that says what will appear there rather than apologising.
 *
 * Panel, not page: this is a lightweight in-context read, which is exactly
 * what shared-ui's Popover is for (no scrim, no scroll lock — the page stays
 * usable behind it).
 */
import { useRef, useState } from "react";
import { Link } from "react-router";
import { Popover } from "@core/shared-ui";
import { m } from "~/paraglide/messages";
import { NoticeList } from "./NoticeList";
import type { NoticeRowData, NoticeRemedy } from "~/lib/notice-view";

export function NoticeBell({
  notices,
  unread,
  align = "right",
  emailComposer,
  showCompany = false,
  emptyBody,
  settingsHref,
  onOpen,
  onMarkAllRead,
  onDismiss,
  onRemedy,
  busy = false,
}: {
  notices: NoticeRowData[];
  unread: number;
  /** Which edge the panel lines up with. "right" suits a bell in a page
   *  header (the panel drops inward); the sidebar bell needs "left" or the
   *  panel opens off the left edge of the window. */
  align?: "left" | "right";
  emailComposer: boolean;
  showCompany?: boolean;
  emptyBody: string;
  /**
   * Where "Notification settings" goes. Optional because not every audience
   * has that screen yet — a footer link to nothing would be worse than none.
   *
   * The bell is the entry point the spec names (§4.1) rather than a nav tab,
   * and the reason is that this is the one place a reader is already thinking
   * about what they are being sent. A tab beside the inspection's own sections
   * would file it as a fact about the inspection, which it is not.
   */
  settingsHref?: string;
  /** Fired once per open — reading a list is not always reading its contents,
   *  so the caller decides whether opening marks anything read. */
  onOpen?: () => void;
  onMarkAllRead: () => void;
  onDismiss: (noticeId: string) => void;
  onRemedy: (remedy: NoticeRemedy) => void;
  /** #106 - the write guard's in-flight flag; see NoticeList's `busy`. */
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) onOpen?.();
        }}
        aria-expanded={open}
        aria-label={unread > 0 ? m.notice_bell_aria({ count: unread }) : m.notice_bell_aria_none()}
        className="relative shrink-0 h-9 w-9 grid place-items-center rounded-lg border border-ih-border bg-ih-bg-card text-ih-fg-3 hover:text-ih-fg-1 hover:bg-ih-bg-muted transition-colors"
      >
        <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
          <path d="M8 2a4 4 0 0 0-4 4v2.6L2.8 11h10.4L12 8.6V6a4 4 0 0 0-4-4z" strokeLinejoin="round" />
          <path d="M6.4 13a1.7 1.7 0 0 0 3.2 0" strokeLinecap="round" />
        </svg>
        {unread > 0 && (
          // The count is in the button's accessible name above; this is the
          // visual echo, so it is aria-hidden rather than read twice.
          <span
            aria-hidden="true"
            className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 grid place-items-center rounded-full bg-ih-primary text-ih-fg-inverse text-[10px] font-bold tabular-nums"
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} align={align}>
        {/* No surface classes here: <Popover> already paints the card, border
            and shadow, and a second one inside it reads as a box in a box. */}
        <div className="w-[min(360px,calc(100vw-2rem))] max-h-[70vh] overflow-y-auto rounded-ih-card">
          <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-3 py-2 border-b border-ih-border bg-ih-bg-card rounded-t-ih-card">
            <span className="text-[11px] font-bold uppercase tracking-widest text-ih-fg-3">
              {m.notice_panel_title()}
            </span>
            {unread > 0 && (
              <button
                type="button"
                onClick={onMarkAllRead}
                disabled={busy}
                aria-busy={busy || undefined}
                className="text-[11px] font-semibold text-ih-fg-3 hover:text-ih-fg-1 disabled:opacity-40 transition-colors"
              >
                {m.notice_panel_mark_all()}
              </button>
            )}
          </div>
          <NoticeList
            notices={notices}
            emailComposer={emailComposer}
            showCompany={showCompany}
            emptyBody={emptyBody}
            onDismiss={onDismiss}
            busy={busy}
            /* A remedy always takes the reader somewhere — the opt-in page, or
               the composer. Leaving the panel open would drop it on top of the
               place it just sent them. Dismiss deliberately does NOT close: a
               reader tidying an inbox usually clears more than one row. */
            onRemedy={(remedy) => {
              setOpen(false);
              onRemedy(remedy);
            }}
          />
          {settingsHref && (
            // Sticky to the bottom for the same reason the header is sticky to
            // the top: a reader scrolling a long list must not have to reach
            // the end of it to find the way out.
            <div className="sticky bottom-0 border-t border-ih-border bg-ih-bg-card rounded-b-ih-card px-3 py-2">
              <Link
                to={settingsHref}
                onClick={() => setOpen(false)}
                className="text-[12px] font-semibold text-ih-fg-2 hover:text-ih-fg-1 transition-colors"
              >
                {m.notice_panel_settings()}
              </Link>
            </div>
          )}
        </div>
      </Popover>
    </>
  );
}
