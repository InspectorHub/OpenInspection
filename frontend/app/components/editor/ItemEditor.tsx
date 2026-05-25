const RATINGS = [
  {
    id: "SAT",
    label: "Sat",
    full: "Satisfactory",
    active: "bg-emerald-100 text-emerald-700 ring-2 ring-emerald-400 dark:bg-emerald-900/30 dark:text-emerald-400",
  },
  {
    id: "MON",
    label: "Mon",
    full: "Monitor",
    active: "bg-amber-100 text-amber-700 ring-2 ring-amber-400 dark:bg-amber-900/30 dark:text-amber-400",
  },
  {
    id: "DEF",
    label: "Def",
    full: "Defect",
    active: "bg-rose-100 text-rose-700 ring-2 ring-rose-400 dark:bg-rose-900/30 dark:text-rose-400",
  },
  {
    id: "NI",
    label: "N/I",
    full: "Not Inspected",
    active: "bg-slate-200 text-slate-700 ring-2 ring-slate-400 dark:bg-slate-600/30 dark:text-slate-300",
  },
  {
    id: "NP",
    label: "N/P",
    full: "Not Present",
    active: "bg-slate-200 text-slate-700 ring-2 ring-slate-400 dark:bg-slate-600/30 dark:text-slate-300",
  },
] as const;

interface ItemEditorProps {
  item: { id: string; label: string; type: string; tabs?: unknown } | undefined;
  sectionTitle: string | undefined;
  result: Record<string, unknown>;
  onRating: (rating: string) => void;
  onNotes: (notes: string) => void;
  onNotesBlur: (notes: string) => void;
}

export function ItemEditor({ item, sectionTitle, result, onRating, onNotes, onNotesBlur }: ItemEditorProps) {
  if (!item) return null;

  return (
    <div className="max-w-2xl space-y-6">
      {/* Eyebrow + title */}
      <div>
        <div className="text-[11px] text-indigo-600 font-bold uppercase tracking-wide">
          {sectionTitle}
        </div>
        <h2 className="text-[19px] font-bold mt-1">{item.label}</h2>
      </div>

      {/* Rating buttons */}
      {item.type === "rich" && (
        <div className="flex gap-2">
          {RATINGS.map((r, idx) => (
            <button
              key={r.id}
              onClick={() => onRating(r.id)}
              title={`${r.full} (${idx + 1})`}
              className={`flex-1 h-[52px] rounded-lg text-[13px] font-bold transition-all ${
                result.rating === r.id
                  ? r.active
                  : "bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-400 dark:hover:bg-slate-600"
              }`}
            >
              {r.label}
              <span className="block text-[9px] font-mono opacity-50 mt-0.5">{idx + 1}</span>
            </button>
          ))}
        </div>
      )}

      {/* Notes textarea */}
      <div>
        <label className="block text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">
          Notes
        </label>
        <textarea
          value={(result.notes as string) || ""}
          onChange={(e) => onNotes(e.target.value)}
          onBlur={(e) => onNotesBlur(e.target.value)}
          placeholder="Add notes — type / for snippets"
          className="w-full h-28 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[13px] resize-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 outline-none"
        />
      </div>

      {/* Photo strip placeholder */}
      <div>
        <label className="block text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">
          Photos
        </label>
        <div className="flex items-center gap-2">
          <button className="w-16 h-16 rounded-lg border-2 border-dashed border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-400 hover:border-indigo-400 hover:text-indigo-500 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
          <span className="text-[11px] text-slate-400">{((result.photos as any[]) || []).length} photos</span>
        </div>
      </div>
    </div>
  );
}
