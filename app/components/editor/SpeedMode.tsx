import { useState, useEffect } from 'react';
import { usePointerGesture } from '../../hooks/usePointerGesture';
import { MobileBottomDrawer } from '../MobileBottomDrawer';
import { SpeedModeUndoToast } from './SpeedModeUndoToast';

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
  ratingLevels?: Array<{ id: string; label: string }>;
  sections?: JumpToSection[];
}

const SPEED_RATINGS = [
  { id: "SAT", label: "Satisfactory", color: "emerald" },
  { id: "MON", label: "Monitor", color: "amber" },
  { id: "DEF", label: "Defect", color: "rose" },
  { id: "NI", label: "N/I", color: "slate" },
  { id: "NP", label: "N/P", color: "slate" },
] as const;

function ratingButtonClass(ratingId: string, currentRating: string | undefined): string {
  if (currentRating !== ratingId) {
    return "bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700";
  }
  switch (ratingId) {
    case "SAT": return "bg-emerald-600 text-white ring-4 ring-emerald-400/50";
    case "MON": return "bg-amber-600 text-white ring-4 ring-amber-400/50";
    case "DEF": return "bg-rose-600 text-white ring-4 ring-rose-400/50";
    default:    return "bg-slate-600 text-white ring-4 ring-slate-400/50";
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

  const handleRatingWithUndo = (newRating: string) => {
    const prevRating: string | null = (result?.rating as string | null) ?? null;
    onRating(newRating);

    const ratingLabel =
      ratingLevels?.find((l) => l.id === newRating)?.label
      ?? SPEED_RATINGS.find((r) => r.id === newRating)?.label
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
    <div className="fixed inset-0 z-[100] bg-slate-900 flex flex-col">
      {/* Top bar */}
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
          <p className="text-[11px] text-slate-500 uppercase tracking-wide">
            Swipe to navigate · Long-press to jump
          </p>
        </div>

        {/* Large rating buttons (kept outside gesture surface so taps fire cleanly) */}
        <div className="flex gap-3">
          {SPEED_RATINGS.map((r, idx) => (
            <button
              key={r.id}
              onClick={() => { handleRatingWithUndo(r.id); onNext(); }}
              className={`w-20 h-20 rounded-xl text-sm font-bold transition-all ${ratingButtonClass(r.id, result.rating as string | undefined)}`}
            >
              {r.label.split(" ")[0]}
              <span className="block text-[10px] opacity-50 mt-1">{idx + 1}</span>
            </button>
          ))}
        </div>

        {/* Nav */}
        <div className="flex gap-4 mt-8">
          <button onClick={onPrev} disabled={currentIndex === 0} className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-30 text-sm">&larr; Prev</button>
          <button onClick={onNext} disabled={currentIndex >= totalCount - 1} className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-30 text-sm">Next &rarr;</button>
        </div>
      </div>

      {/* Footer */}
      <div className="h-10 flex items-center justify-center text-[11px] text-ih-fg-3 border-t border-slate-700">
        Press <kbd className="mx-1 px-1.5 py-0.5 bg-slate-800 rounded text-[10px] font-mono border border-slate-700">Z</kbd> or <kbd className="mx-1 px-1.5 py-0.5 bg-slate-800 rounded text-[10px] font-mono border border-slate-700">Esc</kbd> to exit
      </div>

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
