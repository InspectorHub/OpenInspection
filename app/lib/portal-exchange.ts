/**
 * Per-inspection token exchange + overview resolution for the unified
 * client-portal Hub (app/routes/public/portal-inspection.tsx).
 *
 * Extracted out of the route file (behavior-preserving) purely to keep that
 * file under the repo's file-size ratchet — same host/consumer, no
 * behavioral split. Mirrors the same rationale as app/lib/agent-report-context.ts.
 *
 * Owns the loader's Step 1 (exchange a ?token= for a portal session) and
 * Step 2 (fetch the session-gated overview) — including the Task 6 agent
 * branch: an agent-kind token (server/api/portal.ts exchangeRoute never mints
 * `__Host-portal_session` for one — see SECURITY note there) must be routed
 * to a token-scoped, session-independent report view INSTEAD of the client
 * hub, never bounced to the client login page by the overview's normal 401.
 */
import { redirect, type AppLoadContext } from "react-router";
import type { Api } from "~/lib/api-client.server";
import type { StatusOverview } from "~/components/portal/InspectionStatusCards";
import { loadAgentReportContext } from "~/lib/agent-report-context";

/**
 * Placeholder StatusOverview for an agent-kind token. Agents have no client
 * hub, so the loader forces `section: "report"` and never renders
 * InspectionStatusCards (mounts only on activeSection === "overview" — see
 * InspectionHub.tsx) and HubSectionSlot's "report" branch never reads
 * `overview` at all (see hub/HubSectionSlot.tsx) — the ONLY overview fields
 * InspectionHub itself reads on a non-overview section are `.address` /
 * `.date` for the page header, which the loader backfills from the
 * (already token-scoped) report payload once loadReportSection returns.
 */
const EMPTY_STATUS_OVERVIEW: StatusOverview = {
  inspectionStatus: "",
  agreementSigned: false,
  paymentStatus: "",
  reportPublished: false,
  progress: { completed: 0, total: 0 },
  unreadMessages: 0,
  address: "",
  date: "",
};

export interface PortalSessionResolution {
  overview: StatusOverview;
  /** Server-issued persistent per-inspection token, when the overview call ran (client path only). */
  overviewToken?: string;
  signerToken: string | null;
  /** True when the token resolved to an agent-kind role (Task 6). */
  isAgentToken: boolean;
  /** Full Set-Cookie value to forward to the browser (client/co_client exchange only). */
  cookieToForward: string | null;
  /** Cookie value to present to subsequent same-request API calls. */
  cookieForApi: string;
}

/**
 * Runs the loader's Step 1 (token exchange) + Step 2 (overview fetch),
 * throwing a `redirect`/`Response` exactly as the inline code used to on
 * every non-agent failure path. Client/co_client and existing-session
 * behavior is UNCHANGED; the only new branch is agent-kind, which short-
 * circuits the session-gated overview call entirely.
 */
export async function resolvePortalSession(
  context: AppLoadContext,
  api: Api,
  tenant: string,
  inspectionId: string,
  token: string | null,
  browserCookie: string,
): Promise<PortalSessionResolution> {
  let cookieToForward: string | null = null;
  let cookieForApi = browserCookie;
  let isAgentToken = false;

  // Step 1 — if a per-inspection token is present, try to upgrade it into a
  // portal session. Failure is non-fatal: an existing session may still work.
  if (token) {
    try {
      const ex = await api.portal[":tenant"].exchange.$get({
        param: { tenant },
        query: { token, inspectionId },
      });
      if (ex.status === 200) {
        const exBody = (await ex.json()) as { data?: { email: string; agent?: boolean } };
        isAgentToken = exBody.data?.agent === true;
        if (!isAgentToken) {
          const minted = ex.headers.get("set-cookie");
          if (minted) {
            // Forward the FULL Set-Cookie value to the browser (it carries
            // ; Path=/; HttpOnly; Secure; SameSite=Lax attributes).
            cookieToForward = minted;
            // A Cookie request header must be `name=value` only — slice off the
            // attributes before reusing the minted cookie on the same-request
            // overview call. Fall back to the incoming browser cookie.
            const mintedCookiePair = minted.split(";")[0];
            cookieForApi = mintedCookiePair || browserCookie;
          }
        }
      }
    } catch {
      // ignore — fall through to step 2
    }
  }

  // Step 2 — fetch the overview, forwarding the (possibly freshly-issued)
  // cookie. Skipped entirely for an agent token: the overview endpoint is
  // session-gated and an agent's token intentionally never mints that
  // session (Part A), so calling it would 401 and bounce the agent to the
  // client login page BEFORE the report ever renders. Agents have no client
  // hub anyway — the caller forces the report section off `isAgentToken` and
  // uses this minimal, report-derived overview stand-in instead.
  let overview: StatusOverview;
  let overviewToken: string | undefined;
  let signerToken: string | null = null;

  if (isAgentToken) {
    overview = { ...EMPTY_STATUS_OVERVIEW };
  } else {
    try {
      const res = await api.portal[":tenant"].inspections[":inspectionId"].overview.$get(
        { param: { tenant, inspectionId } },
        { headers: { Cookie: cookieForApi } },
      );
      if (res.status === 401) {
        // Defense-in-depth: the exchange call above may have failed/thrown
        // (network hiccup) even though the token IS agent-kind, so `agent:
        // true` never surfaced. Probe the token-scoped report-context
        // endpoint before bouncing to the client login — an agent must never
        // be redirected away from their own report.
        const fallback = token
          ? await loadAgentReportContext(context, tenant, inspectionId, token)
          : null;
        if (fallback?.kind === "agent") {
          isAgentToken = true;
          overview = { ...EMPTY_STATUS_OVERVIEW };
        } else {
          throw redirect(`/portal/${tenant}`);
        }
      } else if (res.status === 403 || res.status === 404 || !res.ok) {
        throw new Response("Not found", { status: 404 });
      } else {
        const body = (await res.json()) as {
          data?: StatusOverview & { token?: string; signerToken?: string | null };
        };
        if (!body.data) throw new Response("Not found", { status: 404 });
        overview = body.data;
        overviewToken = (overview as StatusOverview & { token?: string }).token;
        signerToken =
          (overview as StatusOverview & { signerToken?: string | null }).signerToken ?? null;
      }
    } catch (err) {
      if (err instanceof Response) throw err;
      throw new Response("Not found", { status: 404 });
    }
  }

  return { overview, overviewToken, signerToken, isAgentToken, cookieToForward, cookieForApi };
}
