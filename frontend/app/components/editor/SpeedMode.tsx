interface SpeedModeProps {
  item: { id: string; label: string; type: string } | null;
  sectionTitle: string;
  result: Record<string, any>;
  onRating: (rating: string) => void;
  onPrev: () => void;
  onNext: () => void;
  onExit: () => void;
  currentIndex: number;
  totalCount: number;
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

export function SpeedMode({ item, sectionTitle, result, onRating, onPrev, onNext, onExit, currentIndex, totalCount }: SpeedModeProps) {
  if (!item) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-slate-900 flex flex-col">
      {/* Top bar */}
      <div className="h-12 flex items-center justify-between px-4 border-b border-slate-700">
        <span className="text-[12px] text-slate-400 font-bold uppercase tracking-wide">{sectionTitle}</span>
        <span className="text-[12px] text-ih-fg-3 font-mono">{currentIndex + 1} / {totalCount}</span>
        <button onClick={onExit} className="text-[12px] text-slate-400 hover:text-white">Exit Speed Mode</button>
      </div>

      {/* Item */}
      <div className="flex-1 flex flex-col items-center justify-center px-8">
        <h2 className="text-2xl font-bold text-white mb-8">{item.label}</h2>

        {/* Large rating buttons */}
        <div className="flex gap-3">
          {SPEED_RATINGS.map((r, idx) => (
            <button
              key={r.id}
              onClick={() => { onRating(r.id); onNext(); }}
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
    </div>
  );
}
