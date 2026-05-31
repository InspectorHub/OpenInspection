import { useState } from "react";

export type ReportTab = "full" | "summary" | "safety";

interface ReportTabBarProps {
  defectCounts: { safety: number; recommendation: number; maintenance: number };
  onTabChange?: (tab: ReportTab) => void;
}

export function ReportTabBar({ defectCounts, onTabChange }: ReportTabBarProps) {
  const [currentTab, setCurrentTab] = useState<ReportTab>("full");
  const totalDefects = defectCounts.safety + defectCounts.recommendation + defectCounts.maintenance;

  function switchTab(tab: ReportTab) {
    setCurrentTab(tab);
    onTabChange?.(tab);
  }

  const tabBase = "px-4 py-3 text-[13px] font-bold transition-colors focus:outline-none focus:bg-slate-50 border-b-2";
  const active = "border-indigo-500 text-slate-900";
  const inactive = "border-transparent text-ih-fg-3 hover:text-slate-900";

  return (
    <div className="flex items-center gap-1 border-b border-slate-200 bg-white sticky top-0 z-20 print:hidden" role="tablist" aria-label="Report view">
      <button type="button" role="tab" aria-selected={currentTab === "full"} onClick={() => switchTab("full")} className={`${tabBase} ${currentTab === "full" ? active : inactive}`}>
        Full Report
      </button>
      <button type="button" role="tab" aria-selected={currentTab === "summary"} onClick={() => switchTab("summary")} className={`${tabBase} ${currentTab === "summary" ? active : inactive} inline-flex items-center gap-1.5`}>
        Summary
        <span className="ih-pill ih-pill--monitor">{totalDefects}</span>
      </button>
      <button type="button" role="tab" aria-selected={currentTab === "safety"} onClick={() => switchTab("safety")} className={`${tabBase} ${currentTab === "safety" ? "border-rose-500 text-slate-900" : inactive} inline-flex items-center gap-1.5`}>
        Safety Hazard
        {defectCounts.safety > 0 && <span className="ih-pill ih-pill--defect">{defectCounts.safety}</span>}
      </button>
    </div>
  );
}
