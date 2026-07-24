import { redirect } from "react-router";
import type { Route } from "./+types/report-gate";

/**
 * IA-45 — the standalone /report-gate page had no producer (nothing linked to
 * it) and its own "Sign agreement" CTA could fall back to itself, forming a
 * closed loop. Its job — telling the client why the report is locked and what
 * to do next — now lives inline on the Hub overview (the surface the client
 * actually reaches), so this route is retired to a permanent redirect. Kept as
 * a fossil (mirrors /reports and /recommendations) in case an old link exists.
 */
export function loader({ params }: Route.LoaderArgs) {
  return redirect(`/portal/${params.tenant}/i/${params.id}?section=overview`, 301);
}

export default function ReportGateRedirect() {
  return null;
}
