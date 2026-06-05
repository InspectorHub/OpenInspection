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

  const tabBase = "px-4 py-3 text-[13px] font-bold transition-colors focus:outline-none focus:bg-ih-bg-muted border-b-2";
  const active = "border-ih-primary text-ih-fg-1";
  const inactive = "border-transparent text-ih-fg-3 hover:text-ih-fg-1";

  return (
    <div className="flex items-center gap-1 border-b border-ih-border bg-ih-bg-card sticky top-0 z-20 print:hidden" role="tablist" aria-label="Report view">
      <button type="button" role="tab" aria-selected={currentTab === "full"} onClick={() => switchTab("full")} className={`${tabBase} ${currentTab === "full" ? active : inactive}`}>
        Full Report
      </button>
      <button type="button" role="tab" aria-selected={currentTab === "summary"} onClick={() => switchTab("summary")} className={`${tabBase} ${currentTab === "summary" ? active : inactive} inline-flex items-center gap-1.5`}>
        Summary
        <span className="ih-pill ih-pill--monitor">{totalDefects}</span>
      </button>
      <button type="button" role="tab" aria-selected={currentTab === "safety"} onClick={() => switchTab("safety")} className={`${tabBase} ${currentTab === "safety" ? "border-ih-bad text-ih-fg-1" : inactive} inline-flex items-center gap-1.5`}>
        Safety Hazard
        {defectCounts.safety > 0 && <span className="ih-pill ih-pill--defect">{defectCounts.safety}</span>}
      </button>
    </div>
  );
}
