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
      <StatCard label="TOTAL ITEMS" value={total} borderClass="border-gray-300" textClass="theme-text-muted" />
      <StatCard label="SATISFACTORY" value={satisfactory} borderClass="border-green-400" textClass="text-green-600" />
      <StatCard label="MONITOR" value={monitor} borderClass="border-amber-400" textClass="text-ih-watch-fg" />
      <StatCard label="DEFECTS" value={defects} borderClass="border-rose-400" textClass="text-ih-bad-fg" />
    </div>
  );
}
