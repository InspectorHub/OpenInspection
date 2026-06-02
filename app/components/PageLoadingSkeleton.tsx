import { Skeleton } from "@core/shared-ui";

/**
 * Generic content-pane loading skeleton shown while a sidebar navigation's
 * route loader is in flight. Roughly mirrors the standard page shape:
 * an eyebrow + title header bar, then a few stacked content blocks.
 *
 * Rendered by AuthLayout in place of the stale <Outlet/> during
 * React Router navigations (navigation.state === "loading").
 */
export function PageLoadingSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading page…</span>

      {/* Header bar: eyebrow + title + a trailing action pill */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="flex flex-col gap-2.5">
          <Skeleton variant="text" width="80px" className="h-2.5" />
          <Skeleton variant="text" width="240px" className="h-6" />
        </div>
        <Skeleton variant="block" width="120px" className="h-9 rounded-md" />
      </div>

      {/* A row of summary tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="bg-ih-bg-card border border-ih-border rounded-lg shadow-ih-card p-5 flex flex-col gap-3"
          >
            <Skeleton variant="text" width="60%" className="h-2.5" />
            <Skeleton variant="text" width="40%" className="h-6" />
          </div>
        ))}
      </div>

      {/* A primary content card with several rows */}
      <div className="bg-ih-bg-card border border-ih-border rounded-lg shadow-ih-card p-6 flex flex-col gap-4">
        <Skeleton variant="text" width="180px" className="h-4 mb-1" />
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-4">
            <Skeleton variant="block" width="40px" className="h-10 rounded-md shrink-0" />
            <div className="flex-1 flex flex-col gap-2">
              <Skeleton variant="text" width={`${70 - i * 8}%`} />
              <Skeleton variant="text" width={`${45 - i * 5}%`} className="h-2.5" />
            </div>
            <Skeleton variant="text" width="64px" className="shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}
