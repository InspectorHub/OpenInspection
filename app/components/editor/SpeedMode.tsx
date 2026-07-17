import { useState, useEffect, useCallback } from 'react';
import { Icon, Button } from '@core/shared-ui';
import { usePointerGesture } from '../../hooks/usePointerGesture';
import { MobileBottomDrawer } from '../MobileBottomDrawer';
import { SpeedModeUndoToast } from './SpeedModeUndoToast';
import { shouldShowSpeedModeCoach, markSpeedModeCoached } from '../../lib/speedmode-coach';
import { m } from "~/paraglide/messages";

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
}

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
}: SpeedModeProps) {
  const [showJumpTo, setShowJumpTo] = useState(false);
  const [pendingUndo, setPendingUndo] = useState<{ message: string; onUndo: () => void } | null>(null);

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
    setPendingUndo(null);
  }, [item?.id]);

  if (!item) return null;

  const levels = ratingLevels && ratingLevels.length > 0 ? ratingLevels : SPEED_FALLBACK_LEVELS;

  const handleRatingWithUndo = (newRating: string) => {
    const prevRating: string | null = (result?.rating as string | null) ?? null;
    onRating(newRating);

    const ratingLabel =
      levels.find((l) => l.id === newRating)?.label
      ?? newRating;
    const message = prevRating
      ? m.editor_speedmode_undo_changed({ rating: ratingLabel })
      : m.editor_speedmode_undo_rated({ rating: ratingLabel });
    setPendingUndo({
      message,
      onUndo: () => {
        onRating((prevRating ?? '') as string);
      },
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={m.editor_speedmode_aria_label()}
      className="fixed inset-0 z-[100] bg-ih-bg-card flex flex-col"
    >
      {/* Top bar */}
      <div className="h-12 flex items-center justify-between px-4 border-b border-ih-border">
        <span className="text-[12px] text-ih-fg-3 font-bold uppercase tracking-wide">{sectionTitle}</span>
        <span className="text-[12px] text-ih-fg-3 font-mono">{currentIndex + 1} / {totalCount}</span>
        <Button variant="ghost" size="sm" onClick={onExit}>{m.editor_speedmode_exit()}</Button>
      </div>

      {/* Item — gesture surface wraps the title/status area, NOT the rating buttons */}
      <div className="flex-1 flex flex-col items-center justify-center px-8">
        <div
          className="touch-none select-none w-full flex flex-col items-center pb-6"
          {...gesture}
        >
          <h2 className="text-2xl font-bold text-ih-fg-1 mb-2 text-center">{item.label}</h2>
          <p className="text-[11px] text-ih-fg-4 uppercase tracking-wide">
            {m.editor_speedmode_gesture_hint()}
          </p>
        </div>

        {/* Large rating buttons (kept outside gesture surface so taps fire cleanly) */}
        <div className="flex gap-3 flex-wrap justify-center">
          {levels.map((r, idx) => {
            const label = r.label ?? r.name ?? r.id;
            return (
              <button
                key={r.id}
                onClick={() => { handleRatingWithUndo(r.id); onNext(); }}
                className={`w-20 h-20 rounded-xl text-sm font-bold transition-all ${ratingButtonClass(r.severity, result.rating === r.id)}`}
              >
                {(r.abbreviation ?? label).split(" ")[0]}
                <span className="block text-[10px] opacity-50 mt-1">{idx + 1}</span>
              </button>
            );
          })}
        </div>

        {/* Nav */}
        <div className="flex gap-4 mt-8">
          <Button variant="secondary" onClick={onPrev} disabled={currentIndex === 0} icon={<Icon name="chevL" size={16} />}>{m.editor_speedmode_prev()}</Button>
          <Button variant="secondary" onClick={onNext} disabled={currentIndex >= totalCount - 1}>{m.common_next()} <Icon name="chevR" size={16} /></Button>
        </div>
      </div>

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
          role="dialog"
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

      {/* Undo toast */}
      <SpeedModeUndoToast
        pending={pendingUndo}
        onDismiss={() => setPendingUndo(null)}
      />

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
                                isActive ? 'bg-ih-bg-muted font-bold text-ih-primary' : 'text-ih-fg-1'
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
