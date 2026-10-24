import { useState, useEffect, useCallback, useRef } from 'react';
import { Icon, Button, useDialogBehavior } from '@core/shared-ui';
import { usePointerGesture } from '../../hooks/usePointerGesture';
import { MobileBottomDrawer } from '../MobileBottomDrawer';
import { SpeedModeUndoToast } from './SpeedModeUndoToast';
import { shouldShowSpeedModeCoach, markSpeedModeCoached } from '../../shared/speedmode-coach';
import { m } from "../../i18n";

/** The touch Prev and Next buttons: at least 44px high, and no double-tap zoom delay. */
const TOUCH_NAV = "min-h-11 touch-manipulation";

interface JumpToSection {
  id: string;
  title?: string;
  name?: string;
  items?: Array<{ id: string; label?: string; name?: string }>;
}

interface SpeedModeProps {
  item: { id: string; label: string; type: string } | null;
  sectionTitle: string;
  result: Record<string, unknown>;
  onRating: (rating: string) => void;
  onPrev: () => void;
  onNext: () => void;
  onExit: () => void;
  currentIndex: number;
  totalCount: number;
  // New optional props for gestures + jump-to
  onNextItem?: () => void;
  onPrevItem?: () => void;
  onJumpTo?: (sectionId: string, itemId: string) => void;
  ratingLevels?: Array<{ id: string; label?: string; name?: string; abbreviation?: string; severity?: string }>;
  sections?: JumpToSection[];
  /**
   * A touch layout (phone, tablet): the overlay uses the dynamic viewport and the safe area, and the rating
   * tiles become a bottom row of 56px targets within thumb reach. Off on desktop, whose markup is unchanged.
   */
  touch?: boolean;
  /**
   * Whether a rating tap also calls `onNext`. Default true. A host whose rating handler already takes the rated
   * item out of the queue (so the cursor already points at the next one) passes false; calling `onNext` as well
   * would skip an item.
   */
  advanceOnRate?: boolean;
  /**
   * Reverts a rating by item id. When given, the Undo toast survives the item change a rating causes and reverts
   * the item that was rated; without it Undo calls `onRating` with the previous value for the item on screen and
   * is cleared as soon as that item changes.
   */
  onUndoRating?: (itemId: string, previous: string | null) => void;
  /**
   * Every item is rated. The overlay stays up, showing "all rated" in place of the tiles, so the last rating can
   * still be undone from its toast; `item` is then the item that was rated last.
   */
  finished?: boolean;
  /**
   * The Undo toast's state, held by the host. Given, the toast survives this component being remounted (a
   * rotation across a layout breakpoint moves Speed mode to another tree); absent, it is kept in here.
   */
  pendingUndo?: SpeedUndo | null;
  onPendingUndoChange?: (undo: SpeedUndo | null) => void;
}

export interface SpeedUndo { message: string; onUndo: () => void; keep?: boolean }

/* B-18 — the old hardcoded SAT/MON/DEF buttons emitted ids the route's
 * `ratingLevels.findIndex(l => l.id === rating)` could never match, so
 * TAPPING a rating in Speed Mode was a silent no-op (only keyboard worked).
 * Buttons now render from the inspection's actual levels; this fallback
 * mirrors the server's fallback ids for the no-levels edge. */
const SPEED_FALLBACK_LEVELS: Array<{ id: string; label?: string; name?: string; abbreviation?: string; severity?: string }> = [
  { id: "Satisfactory", label: "Satisfactory", severity: "good" },
  { id: "Monitor", label: "Monitor", severity: "marginal" },
  { id: "Defect", label: "Defect", severity: "significant" },
  { id: "Not Inspected", label: "N/I", severity: "minor" },
  { id: "Not Present", label: "N/P", severity: "minor" },
];

function ratingButtonClass(severity: string | undefined, isActive: boolean): string {
  if (!isActive) {
    return "bg-ih-bg-muted text-ih-fg-2 hover:bg-ih-border border border-ih-border";
  }
  switch (severity) {
    case "good":        return "bg-ih-ok text-ih-fg-inverse ring-4 ring-ih-ok/50";
    case "marginal":    return "bg-ih-watch text-ih-fg-inverse ring-4 ring-ih-watch/50";
    case "significant": return "bg-ih-bad text-ih-fg-inverse ring-4 ring-ih-bad/50";
    default:            return "bg-ih-bg-inverse text-ih-fg-inverse ring-4 ring-ih-fg-4/30";
  }
}

export function SpeedMode({
  item,
  sectionTitle,
  result,
  onRating,
  onPrev,
  onNext,
  onExit,
  currentIndex,
  totalCount,
  onNextItem,
  onPrevItem,
  onJumpTo,
  ratingLevels,
  sections,
  touch = false,
  advanceOnRate = true,
  onUndoRating,
  finished = false,
  pendingUndo: hostUndo,
  onPendingUndoChange,
}: SpeedModeProps) {
  const [showJumpTo, setShowJumpTo] = useState(false);
  const [ownUndo, setOwnUndo] = useState<SpeedUndo | null>(null);
  const hosted = onPendingUndoChange !== undefined;
  const pendingUndo = hosted ? (hostUndo ?? null) : ownUndo;
  const setPendingUndo = hosted ? onPendingUndoChange : setOwnUndo;
  const undoRef = useRef(pendingUndo);
  undoRef.current = pendingUndo;

  // IA-17 — one-time coach mark on first Speed Mode entry (device-level).
  // Read in an effect (not the initializer) so SSR markup stays stable.
  const [showCoach, setShowCoach] = useState(false);
  useEffect(() => {
    if (shouldShowSpeedModeCoach()) setShowCoach(true);
  }, []);
  const dismissCoach = useCallback(() => {
    setShowCoach(false);
    markSpeedModeCoached();
  }, []);
  // Any keypress while the coach is up dismisses it (the key still does its
  // normal job — we only listen, never swallow).
  useEffect(() => {
    if (!showCoach) return;
    window.addEventListener('keydown', dismissCoach);
    return () => window.removeEventListener('keydown', dismissCoach);
  }, [showCoach, dismissCoach]);

  const gesture = usePointerGesture({
    onSwipeLeft:  () => onNextItem?.(),
    onSwipeRight: () => onPrevItem?.(),
    onLongPress:  () => setShowJumpTo(true),
  });

  // Clear pending undo whenever the active item changes
  useEffect(() => {
    if (undoRef.current && !undoRef.current.keep) setPendingUndo(null);
  }, [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // The shared dialog behaviour: it joins the layer stack for Escape and scroll lock (so a dialog opened
  // from here sits above and Escape closes only the top layer), moves focus into the overlay on open and
  // hands it back to the control that opened it on close. Tab is NOT wrapped on keydown: Tab / Shift+Tab are
  // Speed Mode's next/prev shortcuts (useKeyboard), so focus is contained instead (trapTab: false).
  const rootRef = useRef<HTMLDivElement>(null);
  useDialogBehavior(!!item, onExit, rootRef, rootRef, { trapTab: false });

  if (!item) return null;

  const levels = ratingLevels && ratingLevels.length > 0 ? ratingLevels : SPEED_FALLBACK_LEVELS;

  const handleRatingWithUndo = (newRating: string) => {
    // An empty string (an old document's cleared rating) is no rating: undo must write null, not ''.
    const prevRating: string | null = (result?.rating as string | null) || null;
    onRating(newRating);

    const ratingLabel =
      levels.find((l) => l.id === newRating)?.label
      ?? newRating;
    const message = prevRating
      ? m.editor_speedmode_undo_changed({ rating: ratingLabel })
      : m.editor_speedmode_undo_rated({ rating: ratingLabel });
    const ratedId = item.id;
    setPendingUndo({
      message,
      keep: onUndoRating !== undefined,
      onUndo: () => {
        if (onUndoRating) onUndoRating(ratedId, prevRating);
        else onRating((prevRating ?? '') as string);
      },
    });
  };

  const tiles = levels.map((r, idx) => {
    const label = r.label ?? r.name ?? r.id;
    return (
      <button
        key={r.id}
        onClick={() => { handleRatingWithUndo(r.id); if (advanceOnRate) onNext(); }}
        className={`${touch ? "flex-1 min-w-[5.5rem] min-h-14 touch-manipulation break-words px-1" : "w-20 h-20"} rounded-xl text-sm font-bold transition-all ${ratingButtonClass(r.severity, result.rating === r.id)}`}
      >
        {(r.abbreviation ?? label).split(" ")[0]}
        <span className="block text-[10px] opacity-50 mt-1">{idx + 1}</span>
      </button>
    );
  });

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={m.editor_speedmode_aria_label()}
      tabIndex={-1}
      // Focus now lives in the dialog, so the single-key shortcuts (0 clear, N not applicable, P photo) must be
      // allowed from it; they are otherwise scoped to <body> and data-shortcut-scope containers.
      data-shortcut-scope=""
      style={{ outline: 'none' }}
      className={`fixed inset-0 z-[100] bg-ih-bg-card flex flex-col${touch ? " h-dvh pt-[env(safe-area-inset-top)] pb-[max(1rem,env(safe-area-inset-bottom))]" : ""}`}
    >
      {/* Top bar */}
      <div className={`h-12 flex items-center justify-between px-4 border-b border-ih-border${touch ? " gap-2 shrink-0" : ""}`}>
        <span className={`text-[12px] text-ih-fg-3 font-bold uppercase tracking-wide${touch ? " truncate min-w-0" : ""}`}>{sectionTitle}</span>
        <span className={`text-[12px] text-ih-fg-3 font-mono${touch ? " shrink-0" : ""}`}>{finished ? "" : `${currentIndex + 1} / ${totalCount}`}</span>
        <Button variant="ghost" size="sm" onClick={onExit} className={touch ? "min-h-11 shrink-0 touch-manipulation" : undefined}>{m.editor_speedmode_exit()}</Button>
      </div>

      {/* Item — gesture surface wraps the title/status area, NOT the rating buttons */}
      <div className={`flex-1 flex flex-col items-center justify-center ${touch ? "min-h-0 min-w-0 px-4 overflow-y-auto" : "px-8"}`}>
        <div
          className="touch-none select-none w-full flex flex-col items-center pb-6"
          {...gesture}
        >
          <h2 className={`text-2xl font-bold text-ih-fg-1 mb-2 text-center${touch ? " min-w-0 max-w-full line-clamp-2 break-words" : ""}`}>{finished ? m.editor_speedmode_all_rated() : item.label}</h2>
          {!finished && (
            <p className="text-[11px] text-ih-fg-3 uppercase tracking-wide">
              {m.editor_speedmode_gesture_hint()}
            </p>
          )}
        </div>

        {/* Large rating buttons (kept outside gesture surface so taps fire cleanly) */}
        {!touch && !finished && <div className="flex gap-3 flex-wrap justify-center">{tiles}</div>}

        {/* Nav */}
        {!finished && <div className={`flex gap-4 ${touch ? "mt-2" : "mt-8"}`}>
          <Button variant="secondary" onClick={onPrev} disabled={currentIndex === 0} className={touch ? TOUCH_NAV : undefined} icon={<Icon name="chevL" size={16} />}>{m.editor_speedmode_prev()}</Button>
          <Button variant="secondary" onClick={onNext} disabled={currentIndex >= totalCount - 1} className={touch ? TOUCH_NAV : undefined}>{m.common_next()} <Icon name="chevR" size={16} /></Button>
        </div>}
      </div>

      {/* Touch: the Undo toast takes its own row ABOVE the tiles, so a tap meant for a tile cannot land on Undo. */}
      {touch && (
        <SpeedModeUndoToast pending={pendingUndo} onDismiss={() => setPendingUndo(null)} placement="inline" />
      )}

      {/* Touch: the rating row sits at the bottom, in thumb reach, outside the gesture surface */}
      {touch && !finished && (
        <div data-testid="speedmode-ratings" className="flex flex-wrap gap-2 px-4 pt-3 shrink-0">
          {tiles}
        </div>
      )}

      {/* Footer */}
      <div className="h-10 flex items-center justify-center text-[11px] text-ih-fg-3 border-t border-ih-border">
        {m.editor_speedmode_footer_press()} <kbd className="mx-1 px-1.5 py-0.5 bg-ih-bg-muted rounded text-[10px] font-mono border border-ih-border">Z</kbd> {m.editor_speedmode_footer_or()} <kbd className="mx-1 px-1.5 py-0.5 bg-ih-bg-muted rounded text-[10px] font-mono border border-ih-border">Esc</kbd> {m.editor_speedmode_footer_exit()}
      </div>

      {/* IA-17 — first-run coach mark: tap anywhere (or press any key) to dismiss */}
      {showCoach && (
        <div
          className="absolute inset-0 z-10 bg-ih-backdrop flex items-center justify-center cursor-pointer"
          onPointerDown={dismissCoach}
          data-testid="speedmode-coach"
          role="status"
          aria-label={m.editor_speedmode_coach_aria()}
        >
          <div className="mx-6 max-w-sm rounded-xl border border-ih-border bg-ih-bg-card px-6 py-5 text-ih-fg-2 shadow-ih-popover">
            <h3 className="text-[15px] font-bold text-ih-fg-1 mb-3">{m.editor_speedmode_coach_title()}</h3>
            <ul className="space-y-2 text-[13px]">
              <li className="flex items-center gap-3">
                <kbd className="px-1.5 py-0.5 bg-ih-bg-muted rounded text-[11px] font-mono border border-ih-border shrink-0">1–5</kbd>
                <span>{m.editor_speedmode_coach_rate()}</span>
              </li>
              <li className="flex items-center gap-3">
                <span className="text-[16px] shrink-0" aria-hidden="true">⇄</span>
                <span>{m.editor_speedmode_coach_swipe()}</span>
              </li>
              <li className="flex items-center gap-3">
                <span className="text-[16px] shrink-0" aria-hidden="true">⊙</span>
                <span>{m.editor_speedmode_coach_longpress()}</span>
              </li>
            </ul>
            <p className="mt-4 text-[11px] text-ih-fg-3">{m.editor_speedmode_coach_start()}</p>
          </div>
        </div>
      )}

      {/* Undo toast (touch layouts render theirs inline, above the tiles) */}
      {!touch && (
        <SpeedModeUndoToast
          pending={pendingUndo}
          onDismiss={() => setPendingUndo(null)}
        />
      )}

      {/* Jump-to drawer */}
      <MobileBottomDrawer
        open={showJumpTo}
        onClose={() => setShowJumpTo(false)}
        title={m.editor_speedmode_jumpto_title()}
        heightFraction={0.85}
      >
        <div className="p-2 text-[13px]">
          {sections && sections.length > 0 ? (
            sections.map((sec) => {
              const secTitle = sec.title || sec.name || sec.id;
              const items = sec.items || [];
              return (
                <div key={sec.id} className="mb-3">
                  <div className="px-2 py-1 text-[11px] uppercase tracking-wide font-bold text-ih-fg-3">
                    {secTitle}
                  </div>
                  {items.length === 0 ? (
                    <div className="px-3 py-1 text-[12px] text-ih-fg-3 italic">{m.editor_speedmode_no_items()}</div>
                  ) : (
                    <ul>
                      {items.map((it) => {
                        const itLabel = it.label || it.name || it.id;
                        const isActive = it.id === item.id;
                        return (
                          <li key={it.id}>
                            <button
                              onClick={() => {
                                onJumpTo?.(sec.id, it.id);
                                setShowJumpTo(false);
                              }}
                              className={`w-full text-left px-3 py-2 rounded hover:bg-ih-bg-muted ${
                                isActive ? 'bg-ih-bg-muted font-bold text-ih-primary-text' : 'text-ih-fg-1'
                              }`}
                            >
                              {itLabel}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })
          ) : (
            <div className="p-4 text-ih-fg-3 italic">
              {m.editor_speedmode_sections_unavailable()}
            </div>
          )}
        </div>
      </MobileBottomDrawer>
    </div>
  );
}
