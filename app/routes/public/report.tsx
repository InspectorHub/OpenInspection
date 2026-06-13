import { redirect } from "react-router";
import type { Route } from "./+types/report";

/**
 * Legacy published-report URL. The canonical renderer is now `/report-view/`
 * (report-card-stack.tsx) — the maintained, repair-item-aware view that matches
 * the current getReportData shape. This route previously rendered report.tsx,
 * which read an obsolete shape and crashed.
 *
 * `reportUrl()` (emails, agent-share links, the PDF pipeline) now points at
 * `/report-view/` directly, but already-sent emails and in-flight PDF jobs may
 * still hit `/report/`, so we 302-redirect here, preserving the query string
 * (?token=, ?view=agent) so tokenized client/agent links keep working.
 */
export function loader({ params, request }: Route.LoaderArgs) {
  const { search } = new URL(request.url);
  const tenant = params.tenant ?? "";
  const id = params.id ?? "";
  return redirect(`/report-view/${tenant}/${id}${search}`);
}

export default function LegacyReportRedirect() {
  // The loader always redirects; this never renders.
  return null;
}
