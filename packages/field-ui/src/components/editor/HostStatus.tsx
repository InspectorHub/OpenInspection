import type { ReactNode } from "react";

/**
 * The save indicator, with the host's own status (`FieldHostSlots.renderStatus`) after it. With no host status it is
 * the indicator itself, so a host without the slot gets the markup it always had.
 */
export function WithHostStatus({ indicator, renderStatus }: { indicator: ReactNode; renderStatus?: () => ReactNode }) {
  const host = renderStatus?.();
  if (host == null || host === false) return <>{indicator}</>;
  return (
    <span className="inline-flex shrink-0 items-center gap-2">
      {indicator}
      {host}
    </span>
  );
}
