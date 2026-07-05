import { Skeleton } from "@core/shared-ui";
import { InspectionCardSkeleton } from "./InspectionCardSkeleton";

/**
 * Route-matched loading skeleton for the inspections list (issue #202, Tier 2).
 * Mirrors the real page shape inspections.tsx renders inside the auth-layout
 * content wrapper: a greeting header + actions, the four-up stat-card grid, the
 * workflow tab strip, and a card holding several inspection rows. Showing this
 * during navigation keeps the page from going blank and avoids the layout shift
 * a generic skeleton causes. (The auth-layout already supplies the
 * `max-w-[1080px] … px-9` wrapper, so this renders the inner content only.)
 */
export function InspectionsListSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-ih-list">
      <span className="sr-only">Loading inspections…</span>

      {/* Header: greeting + meta on the left, action buttons on the right */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2.5">
          <Skeleton variant="text" width="220px" className="h-7" />
          <Skeleton variant="text" width="300px" className="h-3" />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Skeleton variant="block" width="160px" className="h-8 rounded-md" />
          <Skeleton variant="block" width="120px" className="h-8 rounded-md" />
        </div>
      </div>

      {/* Stat cards — four-up grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="bg-ih-bg-card border border-ih-border rounded-lg shadow-ih-card p-ih-card flex flex-col gap-3"
          >
            <Skeleton variant="block" width="40px" className="h-10 rounded-md" />
            <Skeleton variant="text" width="48px" className="h-6" />
            <Skeleton variant="text" width="80%" className="h-2.5" />
          </div>
        ))}
      </div>

      {/* Workflow tab strip */}
      <div className="flex items-center gap-4 border-b border-ih-border pb-2">
        {[64, 80, 72, 88, 60].map((w, i) => (
          <Skeleton key={i} variant="text" width={`${w}px`} className="h-3.5" />
        ))}
      </div>

      {/* Inspection list card */}
      <div className="bg-ih-bg-card border border-ih-border rounded-lg shadow-ih-card overflow-hidden">
        <div className="px-4 py-2 border-b border-ih-border">
          <Skeleton variant="text" width="80px" className="h-2.5" />
        </div>
        <div className="divide-y divide-ih-border">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <InspectionCardSkeleton key={i} widthPct={72 - i * 6} />
          ))}
        </div>
      </div>
    </div>
  );
}
