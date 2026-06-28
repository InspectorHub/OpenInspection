import { Skeleton } from "@core/shared-ui";

/**
 * Skeleton row that mirrors <DashboardInspectionRow> (issue #202, Tier 2): the
 * same `px-4 py-3` padding, a leading checkbox-sized block, a two-line
 * address + meta stack on the left, and a status pill on the right. Used to
 * pre-render the inspection list structure while its loader is in flight, so the
 * page shows its real shape instead of going blank.
 */
export function InspectionCardSkeleton({ widthPct = 70 }: { widthPct?: number }) {
  return (
    <div className="flex items-center gap-2 px-4 py-3">
      <Skeleton variant="block" width="14px" className="h-3.5 rounded-sm shrink-0" />
      <div className="flex items-center justify-between flex-1 min-w-0">
        <div className="min-w-0 flex flex-col gap-1.5">
          <Skeleton variant="text" width={`${widthPct}%`} className="h-3" />
          <Skeleton variant="text" width={`${widthPct - 25}%`} className="h-2.5" />
        </div>
        <Skeleton variant="block" width="72px" className="h-5 rounded-full shrink-0 ml-4" />
      </div>
    </div>
  );
}
