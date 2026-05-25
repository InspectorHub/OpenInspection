interface Tally {
  def: number;
  mon: number;
  sat: number;
  unrated: number;
}

interface Completion {
  rated: number;
  total: number;
  percent: number;
}

interface WorkflowState {
  tone: "ok" | "watch" | "bad" | "muted";
  label: string;
}

interface ProgressStripProps {
  completion: Completion;
  tally: Tally;
  etaMin?: number;
  agreement?: WorkflowState;
  payment?: WorkflowState;
}

function WorkflowChipInline({ label, state }: { label: string; state?: WorkflowState }) {
  if (!state) return null;
  const toneClasses =
    state.tone === "ok" ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300" :
    state.tone === "watch" ? "border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300" :
    state.tone === "bad" ? "border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300" :
    "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400";

  const dotClass =
    state.tone === "ok" ? "bg-emerald-500" :
    state.tone === "watch" ? "bg-amber-500" :
    state.tone === "bad" ? "bg-rose-500" :
    "bg-slate-300 dark:bg-slate-600";

  return (
    <span className={`inline-flex items-center gap-1.5 h-6 px-2 rounded-md border text-[11px] font-bold ${toneClasses}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} />
      <span className="opacity-75 font-semibold">{label}</span>
      <span>{state.label}</span>
    </span>
  );
}

export function ProgressStrip({ completion, tally, etaMin, agreement, payment }: ProgressStripProps) {
  const dashValue = (completion.percent * 0.942).toFixed(1);

  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900" aria-label="Inspection progress">
      {/* Donut ring */}
      <div className="relative w-10 h-10 shrink-0">
        <svg className="w-10 h-10" viewBox="0 0 36 36" aria-hidden="true">
          <circle cx={18} cy={18} r={15} fill="none" stroke="currentColor" strokeWidth={3} className="text-slate-200 dark:text-slate-700" />
          <circle
            cx={18} cy={18} r={15}
            fill="none"
            stroke="currentColor"
            strokeWidth={3}
            strokeLinecap="round"
            strokeDasharray={`${dashValue}, 100`}
            transform="rotate(-90 18 18)"
            className="text-indigo-500"
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold tabular-nums text-slate-900 dark:text-slate-100 font-mono">
          {completion.percent}
        </span>
      </div>

      {/* Counts + ETA */}
      <div className="min-w-0 leading-tight">
        <div className="text-[13px] font-bold text-slate-900 dark:text-slate-100 tabular-nums">
          {completion.rated}
          <span className="text-slate-400 dark:text-slate-500 font-normal"> / {completion.total}</span>
          <span className="text-slate-500 dark:text-slate-400 font-medium ml-2">items rated</span>
        </div>
        {etaMin != null && etaMin > 0 && (
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            ETA <span className="tabular-nums font-semibold text-slate-700 dark:text-slate-300">~{etaMin} min</span>
          </div>
        )}
      </div>

      {/* Tally chips */}
      <div className="flex items-center gap-1.5 flex-wrap" role="group" aria-label="Rating breakdown">
        {tally.def > 0 && (
          <span className="inline-flex items-center gap-1.5 h-6 px-2 rounded-full text-[11px] font-bold tabular-nums bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300">
            {tally.def} <span className="font-semibold opacity-80">def</span>
          </span>
        )}
        {tally.mon > 0 && (
          <span className="inline-flex items-center gap-1.5 h-6 px-2 rounded-full text-[11px] font-bold tabular-nums bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
            {tally.mon} <span className="font-semibold opacity-80">mon</span>
          </span>
        )}
        {tally.sat > 0 && (
          <span className="inline-flex items-center gap-1.5 h-6 px-2 rounded-full text-[11px] font-bold tabular-nums bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">
            {tally.sat} <span className="font-semibold opacity-80">sat</span>
          </span>
        )}
        {tally.unrated > 0 && (
          <span className="inline-flex items-center gap-1.5 h-6 px-2 rounded-full text-[11px] font-bold tabular-nums bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
            {tally.unrated} <span className="font-semibold opacity-80">unrated</span>
          </span>
        )}
      </div>

      <span className="flex-1" />

      {/* Workflow chips */}
      <div className="flex items-center gap-1.5 flex-wrap" role="group" aria-label="Inspection workflow">
        <WorkflowChipInline label="Agreement" state={agreement} />
        <WorkflowChipInline label="Payment" state={payment} />
      </div>
    </div>
  );
}
