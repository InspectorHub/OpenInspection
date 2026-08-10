import { useEffect, useState, type ComponentType } from "react";
import { Skeleton } from "@core/shared-ui";

type NoticeProps = { className?: string };

/**
 * Loads the viewer's timezone control only for pages that will actually show it
 * (#99).
 *
 * ── What this saves, and from whom ──
 * The control's zone table costs ~160-230ms to build cold at a 6x CPU throttle.
 * On `/verify` and `/concierge-confirm-token` whether it renders at all is
 * decided by loader data the SERVER already has — an envelope with no signed
 * signer, or an inspection with no date, never shows it. Those visitors used to
 * pay the full build during hydration anyway, because the import was static.
 * Here the chunk is never requested for them.
 *
 * ── Why a dynamic import and not `lazy` + `Suspense` ──
 * `lazy` would suspend during SSR and put the fallback in the server HTML. This
 * control is client-only by design: it returns null until the browser zone
 * resolves after mount, so SSR renders nothing today. Rendering nothing until
 * mounted keeps that exactly — a no-JS viewer, and the PDF renderer, still get
 * clean output rather than a skeleton that never resolves.
 *
 * ── Why a skeleton at all ──
 * The chunk arrives after hydration, so without one the surrounding content
 * would shift when it lands. It is sized to the real control and hidden in
 * print for the same reason the control is.
 *
 * A failed chunk load renders nothing. The zone picker is a convenience over an
 * already-correct UTC anchor; a broken-looking placeholder would be worse than
 * its absence.
 */
export function LazyViewerTimeZoneNotice({ className }: NoticeProps) {
  const [Notice, setNotice] = useState<ComponentType<NoticeProps> | null>(null);
  const [mounted, setMounted] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setMounted(true);
    import("~/components/public/ViewerTimeZoneNotice")
      .then((mod) => {
        if (alive) setNotice(() => mod.ViewerTimeZoneNotice);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Server render and the first client render agree on "nothing", which is what
  // this page emitted before the split — so hydration has nothing to reconcile.
  if (!mounted || failed) return null;
  if (!Notice) {
    return (
      <div className={`print:hidden space-y-1 ${className ?? ""}`} aria-hidden="true">
        <Skeleton width="14rem" />
        <Skeleton width="9rem" />
      </div>
    );
  }
  return <Notice className={className} />;
}
