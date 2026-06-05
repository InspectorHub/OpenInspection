interface StatsCardsProps {
  total: number;
  satisfactory: number;
  monitor: number;
  defects: number;
}

function StatCard({ label, value, borderClass, textClass }: { label: string; value: number; borderClass: string; textClass: string }) {
  return (
    <div className={`theme-card p-[14px] border-l-4 ${borderClass}`}>
      <div className={`text-[10px] font-semibold tracking-wider ${textClass}`}>{label}</div>
      <div className="text-xl font-bold mt-1 theme-font-display">{value}</div>
    </div>
  );
}

export function StatsCards({ total, satisfactory, monitor, defects }: StatsCardsProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <StatCard label="TOTAL ITEMS" value={total} borderClass="border-ih-border-strong" textClass="theme-text-muted" />
      <StatCard label="SATISFACTORY" value={satisfactory} borderClass="border-ih-ok" textClass="text-ih-ok-fg" />
      <StatCard label="MONITOR" value={monitor} borderClass="border-ih-watch" textClass="text-ih-watch-fg" />
      <StatCard label="DEFECTS" value={defects} borderClass="border-ih-bad" textClass="text-ih-bad-fg" />
    </div>
  );
}
