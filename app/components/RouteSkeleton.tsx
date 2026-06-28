import { PageLoadingSkeleton } from "~/components/PageLoadingSkeleton";
import { InspectionsListSkeleton } from "~/components/dashboard/InspectionsListSkeleton";

/**
 * Picks the loading skeleton that best matches the route being navigated to
 * (issue #202, Tier 2). A route-matched skeleton mimics the destination's real
 * layout — header, stat cards, list rows — so the page keeps its shape during
 * the loader wait instead of flashing a generic placeholder and then shifting.
 * Unknown routes fall back to the generic <PageLoadingSkeleton>.
 *
 * Exported as a pure path→component map so the matching is unit-testable.
 */
export function skeletonForPath(pathname: string): React.ReactNode {
  // Inspections LIST only (exact). Detail (/inspections/:id) and the editor
  // (/inspections/:id/edit) have their own shapes — keep the generic fallback
  // for them rather than showing a list skeleton that wouldn't match.
  if (pathname === "/inspections" || pathname === "/inspections/") {
    return <InspectionsListSkeleton />;
  }
  return <PageLoadingSkeleton />;
}

export function RouteSkeleton({ pathname }: { pathname: string }) {
  return <>{skeletonForPath(pathname)}</>;
}
