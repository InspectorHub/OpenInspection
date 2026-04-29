interface StatsCardsProps {
  /** Use Alpine.js binding when stats are dynamic, or pass static values for SSR */
  alpine?: boolean;
}

export function StatsCards({ alpine = false }: StatsCardsProps): JSX.Element {
  if (alpine) {
    return (
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="TOTAL ITEMS" valueExpr="reportStats.total" borderClass="border-gray-300" />
        <StatCard label="SATISFACTORY" valueExpr="reportStats.satisfactory" borderClass="border-green-400" />
        <StatCard label="MONITOR" valueExpr="reportStats.monitor" borderClass="border-amber-400" />
        <StatCard label="DEFECTS" valueExpr="reportStats.defect" borderClass="border-rose-400" />
      </div>
    );
  }

  return (
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <div class="theme-card p-4 border-l-4 border-gray-300">
        <div class="text-[10px] font-semibold tracking-wider theme-text-muted">TOTAL ITEMS</div>
        <div class="text-3xl font-bold mt-1 theme-font-display" id="stat-total">--</div>
      </div>
      <div class="theme-card p-4 border-l-4 border-green-400">
        <div class="text-[10px] font-semibold tracking-wider text-green-600">SATISFACTORY</div>
        <div class="text-3xl font-bold mt-1 theme-font-display" id="stat-satisfactory">--</div>
      </div>
      <div class="theme-card p-4 border-l-4 border-amber-400">
        <div class="text-[10px] font-semibold tracking-wider text-amber-600">MONITOR</div>
        <div class="text-3xl font-bold mt-1 theme-font-display" id="stat-monitor">--</div>
      </div>
      <div class="theme-card p-4 border-l-4 border-rose-400">
        <div class="text-[10px] font-semibold tracking-wider text-rose-600">DEFECTS</div>
        <div class="text-3xl font-bold mt-1 theme-font-display" id="stat-defect">--</div>
      </div>
    </div>
  );
}

function StatCard({ label, valueExpr, borderClass }: { label: string; valueExpr: string; borderClass: string }): JSX.Element {
  const colorClass = label === 'SATISFACTORY' ? 'text-green-600' :
    label === 'MONITOR' ? 'text-amber-600' :
    label === 'DEFECTS' ? 'text-rose-600' : 'theme-text-muted';

  return (
    <div class={`theme-card p-4 border-l-4 ${borderClass}`}>
      <div class={`text-[10px] font-semibold tracking-wider ${colorClass}`}>{label}</div>
      <div class="text-3xl font-bold mt-1 theme-font-display" x-text={valueExpr}>--</div>
    </div>
  );
}
