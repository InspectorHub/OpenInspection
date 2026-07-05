import { useState, useEffect, useCallback } from 'react';
import { usePointerGesture } from '../../hooks/usePointerGesture';
import { MobileBottomDrawer } from '../MobileBottomDrawer';
import { SpeedModeUndoToast } from './SpeedModeUndoToast';
import { shouldShowSpeedModeCoach, markSpeedModeCoached } from '../../lib/speedmode-coach';

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
    // ds-allow: fixed-dark surface
    return "bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700";
  }
  switch (severity) {
    case "good":        return "bg-ih-ok text-white ring-4 ring-ih-ok/50";
    case "marginal":    return "bg-ih-watch text-white ring-4 ring-ih-watch/50";
    case "significant": return "bg-ih-bad text-white ring-4 ring-ih-bad/50";
    // ds-allow: fixed-dark surface
    default:            return "bg-slate-600 text-white ring-4 ring-slate-400/50";
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
      ? `Changed to ${ratingLabel}.`
      : `Rated as ${ratingLabel}.`;
    setPendingUndo({
      message,
      onUndo: () => {
        onRating((prevRating ?? '') as string);
      },
    });
  };

  return (
    /* ds-allow: fixed-dark surface */
    <div className="fixed inset-0 z-[100] bg-slate-900 flex flex-col">
      {/* Top bar */}
      {/* ds-allow: fixed-dark surface */}
      <div className="h-12 flex items-center justify-between px-4 border-b border-slate-700">
        <span className="text-[12px] text-slate-400 font-bold uppercase tracking-wide">{sectionTitle}</span>
        <span className="text-[12px] text-ih-fg-3 font-mono">{currentIndex + 1} / {totalCount}</span>
        <button onClick={onExit} className="text-[12px] text-slate-400 hover:text-white">Exit Speed Mode</button>
      </div>

      {/* Item — gesture surface wraps the title/status area, NOT the rating buttons */}
      <div className="flex-1 flex flex-col items-center justify-center px-8">
        <div
          className="touch-none select-none w-full flex flex-col items-center pb-6"
          {...gesture}
        >
          <h2 className="text-2xl font-bold text-white mb-2 text-center">{item.label}</h2>
          {/* ds-allow: fixed-dark surface */}
          <p className="text-[11px] text-slate-500 uppercase tracking-wide">
            Swipe to navigate · Long-press to jump
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
        {/* ds-allow: fixed-dark surface */}
        <div className="flex gap-4 mt-8">
          <button onClick={onPrev} disabled={currentIndex === 0} className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-30 text-sm">&larr; Prev</button>
          <button onClick={onNext} disabled={currentIndex >= totalCount - 1} className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-30 text-sm">Next &rarr;</button>
        </div>
      </div>

      {/* Footer */}
      {/* ds-allow: fixed-dark surface */}
      <div className="h-10 flex items-center justify-center text-[11px] text-ih-fg-3 border-t border-slate-700">
        Press <kbd className="mx-1 px-1.5 py-0.5 bg-slate-800 rounded text-[10px] font-mono border border-slate-700">Z</kbd> or <kbd className="mx-1 px-1.5 py-0.5 bg-slate-800 rounded text-[10px] font-mono border border-slate-700">Esc</kbd> to exit
      </div>

      {/* IA-17 — first-run coach mark: tap anywhere (or press any key) to dismiss */}
      {showCoach && (
        // ds-allow: fixed-dark surface
        <div
          className="absolute inset-0 z-10 bg-slate-900/80 flex items-center justify-center cursor-pointer"
          onPointerDown={dismissCoach}
          data-testid="speedmode-coach"
          role="dialog"
          aria-label="Speed Mode tips"
        >
          {/* ds-allow: fixed-dark surface */}
          <div className="mx-6 max-w-sm rounded-xl border border-slate-600 bg-slate-800/95 px-6 py-5 text-slate-200 shadow-2xl">
            <h3 className="text-[15px] font-bold text-white mb-3">Speed Mode</h3>
            <ul className="space-y-2 text-[13px]">
              <li className="flex items-center gap-3">
                {/* ds-allow: fixed-dark surface */}
                <kbd className="px-1.5 py-0.5 bg-slate-700 rounded text-[11px] font-mono border border-slate-600 shrink-0">1–5</kbd>
                <span>Rate the current item</span>
              </li>
              <li className="flex items-center gap-3">
                <span className="text-[16px] shrink-0" aria-hidden="true">⇄</span>
                <span>Swipe left / right to change item</span>
              </li>
              <li className="flex items-center gap-3">
                <span className="text-[16px] shrink-0" aria-hidden="true">⊙</span>
                <span>Long-press to jump to a section</span>
              </li>
            </ul>
            {/* ds-allow: fixed-dark surface */}
            <p className="mt-4 text-[11px] text-slate-400">Tap anywhere to start</p>
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
        title="Jump to"
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
                    <div className="px-3 py-1 text-[12px] text-ih-fg-3 italic">No items</div>
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
              Sections list unavailable.
            </div>
          )}
        </div>
      </MobileBottomDrawer>
    </div>
  );
}
