/**
 * Agent report-landing context (Spec 3 Task 3) — resolves whether the durable
 * report token's (ctx.token) recipient is agent-kind and, if so, whether they
 * already have a global agent account, via POST /api/agent/report-context.
 * Consumed by the portal-inspection BFF loader to decide which CTA
 * <AgentReportActions> renders below the report body: "Go to my workspace"
 * (magic-login) vs "Create your free agent account" (signup).
 *
 * Extracted into its own file (rather than living in section-loaders.ts
 * alongside it) purely to keep that file under the repo's file-size ratchet —
 * same host/consumer, no behavioral split.
 */
import type { AppLoadContext } from "react-router";

/**
 * Non-null only when ctx.token's recipient is agent-kind; null covers every
 * other case (client/other-kind token, invalid/expired token, no token, or a
 * failed probe) — the Report section CTA simply doesn't render in those cases.
 */
export interface AgentReportContext {
  kind: "agent";
  recipientEmail: string;
  hasAccount: boolean;
}

/**
 * Best-effort: any failure (network, non-OK, malformed body) degrades to null
 * so the report itself is never blocked on this call — mirrors the
 * documents-section fetch's own try/catch-to-empty pattern
 * (app/lib/section-loaders.ts / app/routes/public/portal-inspection.tsx,
 * `section === "documents"` branch).
 */
export async function loadAgentReportContext(
  context: AppLoadContext,
  tenant: string,
  inspectionId: string,
  token: string,
): Promise<AgentReportContext | null> {
  if (!token) return null;
  try {
    const apiWorker = context.cloudflare.env.API_WORKER;
    const res = await (apiWorker?.fetch ?? fetch)(
      new Request("https://internal/api/agent/report-context", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenant, inspectionId, token }),
      }),
    );
    if (!res.ok) return null;
    const body = (await res.json()) as {
      data?: { kind: string | null; recipientEmail?: string; hasAccount?: boolean };
    };
    const data = body.data;
    if (data?.kind === "agent" && data.recipientEmail && typeof data.hasAccount === "boolean") {
      return { kind: "agent", recipientEmail: data.recipientEmail, hasAccount: data.hasAccount };
    }
    return null;
  } catch {
    // Best-effort: fail open to no CTA — the report still renders.
    return null;
  }
}
