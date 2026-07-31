/**
 * The Hub action's "Go to my workspace" branch (Spec 3 Task 3).
 *
 * Extracted from app/routes/public/portal-inspection.tsx for the file-size
 * ratchet — same host, same caller, no behavioural split. Sits beside
 * portal-exchange.ts and portal-notices.ts, which came out of the same route
 * for the same reason.
 *
 * BFF only (CLAUDE.md): <AgentReportActions> posts an intent to the route
 * action, which relays through the typed client. A browser
 * `fetch('/api/...')` would carry no auth.
 */
import type { Api } from "~/lib/api-client.server";

export type AgentMagicLoginActionResult =
  | { ok: true; intent: "agent-magic-login"; sent: boolean }
  | { ok: false; intent: "agent-magic-login"; error?: string }
  | { ok: false; intent: string };

export async function handleAgentMagicLogin(
  api: Api,
  tenant: string,
  inspectionId: string,
  token: string,
): Promise<AgentMagicLoginActionResult> {
  // IA-47 — returnTo is derived HERE, server-side, never taken from the
  // client, so the redeem step lands the agent back on this exact report page
  // and the parameter can never become an open-redirect vector.
  const returnTo = `/portal/${tenant}/i/${inspectionId}?token=${encodeURIComponent(token)}&section=report`;
  try {
    const res = (await api.agentMagicLogin["magic-login"].request.$post({
      json: { tenant, inspectionId, token, returnTo },
    })) as unknown as Response;
    if (!res.ok) return { ok: false, intent: "agent-magic-login" };
    const body = (await res.json()) as { data?: { sent?: boolean } };
    return { ok: true, intent: "agent-magic-login", sent: body.data?.sent ?? true };
  } catch {
    return { ok: false, intent: "agent-magic-login" };
  }
}
