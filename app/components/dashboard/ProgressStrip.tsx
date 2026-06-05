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
 state.tone === "ok" ? "border-ih-ok bg-ih-ok-bg text-ih-ok-fg" :
 state.tone === "watch" ? "border-ih-watch bg-ih-watch-bg text-ih-watch-fg" :
 state.tone === "bad" ? "border-ih-bad bg-ih-bad-bg text-ih-bad-fg" :
 "border-ih-border bg-ih-bg-app text-ih-fg-3";

 const dotClass =
 state.tone === "ok" ? "bg-ih-ok" :
 state.tone === "watch" ? "bg-ih-watch" :
 state.tone === "bad" ? "bg-ih-bad" :
 "bg-ih-bg-muted";

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
 <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 border-b border-ih-border bg-ih-bg-card" aria-label="Inspection progress">
 {/* Donut ring */}
 <div className="relative w-10 h-10 shrink-0">
 <svg className="w-10 h-10" viewBox="0 0 36 36" aria-hidden="true">
 <circle cx={18} cy={18} r={15} fill="none" stroke="currentColor" strokeWidth={3} className="text-ih-fg-5" />
 <circle
 cx={18} cy={18} r={15}
 fill="none"
 stroke="currentColor"
 strokeWidth={3}
 strokeLinecap="round"
 strokeDasharray={`${dashValue}, 100`}
 transform="rotate(-90 18 18)"
 className="text-ih-primary"
 />
 </svg>
 <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold tabular-nums text-ih-fg-1 font-mono">
 {completion.percent}
 </span>
 </div>

 {/* Counts + ETA */}
 <div className="min-w-0 leading-tight">
 <div className="text-[13px] font-bold text-ih-fg-1 tabular-nums">
 {completion.rated}
 <span className="text-ih-fg-4 font-normal"> / {completion.total}</span>
 <span className="text-ih-fg-3 font-medium ml-2">items rated</span>
 </div>
 {etaMin != null && etaMin > 0 && (
 <div className="text-[11px] text-ih-fg-3 mt-0.5">
 ETA <span className="tabular-nums font-semibold text-ih-fg-3">~{etaMin} min</span>
 </div>
 )}
 </div>

 {/* Tally chips */}
 <div className="flex items-center gap-1.5 flex-wrap" role="group" aria-label="Rating breakdown">
 {tally.def > 0 && (
 <span className="inline-flex items-center gap-1.5 h-6 px-2 rounded-full text-[11px] font-bold tabular-nums bg-ih-bad-bg text-ih-bad-fg">
 {tally.def} <span className="font-semibold opacity-80">def</span>
 </span>
 )}
 {tally.mon > 0 && (
 <span className="inline-flex items-center gap-1.5 h-6 px-2 rounded-full text-[11px] font-bold tabular-nums bg-ih-watch-bg text-ih-watch-fg">
 {tally.mon} <span className="font-semibold opacity-80">mon</span>
 </span>
 )}
 {tally.sat > 0 && (
 <span className="inline-flex items-center gap-1.5 h-6 px-2 rounded-full text-[11px] font-bold tabular-nums bg-ih-ok-bg text-ih-ok-fg">
 {tally.sat} <span className="font-semibold opacity-80">sat</span>
 </span>
 )}
 {tally.unrated > 0 && (
 <span className="inline-flex items-center gap-1.5 h-6 px-2 rounded-full text-[11px] font-bold tabular-nums bg-ih-bg-muted text-ih-fg-3">
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
