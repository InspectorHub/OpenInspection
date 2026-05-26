interface AgentDashboardHeroProps {
  propertyAddress?: string;
  scheduledAt?: string;
  inspectorName?: string;
  clientName?: string;
  onShareToBuyer?: () => void;
}

export function AgentDashboardHero({
  propertyAddress,
  scheduledAt,
  inspectorName,
  clientName,
  onShareToBuyer,
}: AgentDashboardHeroProps) {
  const title = propertyAddress || "Your referrals at a glance";
  const subline =
    scheduledAt || clientName
      ? `${scheduledAt ?? ""}${scheduledAt && clientName ? " · for " : ""}${clientName ?? ""}`
      : "Share inspection reports with the buyer in one click.";

  return (
    <section className="relative rounded-xl overflow-hidden bg-slate-900 text-white">
      <div className="absolute inset-0" style={{ backgroundImage: "radial-gradient(circle at 30% 40%, rgba(99,102,241,0.18) 0%, transparent 55%)" }} aria-hidden="true" />
      <div className="relative px-6 py-8 md:px-10 md:py-10">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
          <div className="space-y-2 min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-indigo-300">Inspection Report</p>
            <h1 className="text-[22px] md:text-[28px] font-bold tracking-tight text-white leading-tight">{title}</h1>
            <p className="text-[13px] text-slate-300 font-medium">{subline}</p>
            {inspectorName && (
              <div className="flex items-center gap-2 mt-3 flex-wrap">
                <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/20 text-[11px] font-bold uppercase tracking-wider">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
                  Inspector: {inspectorName}
                </span>
              </div>
            )}
          </div>
          <div className="flex flex-col sm:flex-row md:flex-col gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={onShareToBuyer}
              className="h-10 px-5 rounded-md bg-amber-400 text-amber-950 text-[13px] font-bold inline-flex items-center justify-center gap-1.5 hover:bg-amber-300 active:scale-95 transition-all focus:outline-none focus:ring-2 focus:ring-white/30 shadow-lg"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>
              Share with your buyer
            </button>
            <a href="#full-report" className="h-10 px-5 rounded-md bg-white/10 border border-white/20 text-white text-[13px] font-bold inline-flex items-center justify-center gap-1.5 hover:bg-white/20 transition-colors focus:outline-none focus:ring-2 focus:ring-white/30">
              View full report
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
