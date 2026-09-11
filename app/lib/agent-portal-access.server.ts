import { redirect } from "react-router";

/**
 * Who the agent portal is for — read off the API's own answer, never decided here.
 *
 * `requireToken` answers one question: is there a session at all. Every `/agent-*`
 * page used that as its whole admission rule, so any signed-in staff member who
 * typed `/agent-dashboard` was served the agent portal shell — empty, because the
 * API refused every data call behind it with
 * `403 {"error":{"message":"Requires one of [agent]"}}`, and greeted by a "couldn't
 * be loaded, reload the page" message that described a broken page rather than the
 * wrong audience. No data leaked; the wrong person was still shown somebody else's
 * front door and given no way to tell.
 *
 * ── Why this reads a response instead of reading the role ────────────────────
 * The session token carries a role claim and this file deliberately does not look
 * at it. Authorization is decided where it is ENFORCED — `requireRole('agent')` on
 * every `/api/agent/*` route (server/api/agent.ts) — and the JWT payload as seen
 * from the app tier is unverified input (`isTokenExpired`'s comment in
 * session.server.ts makes the same point). So the loader asks the API a question it
 * already has to ask (`GET /api/agent/profile`, which the agent portal needs for
 * the agent's own identity and timezone) and obeys the answer. A page therefore
 * cannot offer what the API refuses, and the two can never drift apart, because
 * there is only one decision.
 *
 * ── Fail closed, three ways ─────────────────────────────────────────────────
 * 403 — authenticated, not an agent. Sent to the staff home (`/`, which resolves to
 *   `/inspections` for a token holder) because that is where this person belongs;
 *   `/agent-login` would invite them to replace their working session with one they
 *   do not have.
 * 401 — the API will not accept this token (a rotated signing key, a forged value).
 *   `requireToken` already handled plain expiry. Sent to the agent door, which needs
 *   no session and therefore cannot loop.
 * no answer at all — the in-process call threw, so there IS no decision to obey.
 *   Refused as 503 rather than redirected: a redirect needs a destination, and
 *   every destination is wrong when the thing that failed is "who is this". The
 *   previous code treated this as "not an agent yet, carry on", which is the one
 *   reading that admits everybody when the decision is unavailable.
 */

/** Exactly what this needs: an HTTP status. The typed Hono client's
 *  `ClientResponse` is not a DOM `Response`, so demanding that type would force
 *  every caller to widen a value the client had typed precisely (same reasoning
 *  as `StatusAndJson` in agent-terms.server.ts). */
type StatusOnly = { status: number };

/**
 * Refuse a session the agent API will not serve.
 *
 * Does NOT read the body, so the caller can still parse it afterwards — the
 * agent-terms redirect and the profile read both do.
 *
 * Statuses other than 401/403 pass: a 404 is an agent whose profile row cannot be
 * found, which is a broken record rather than the wrong audience, and a 428 is the
 * agent-terms gate, whose own redirect runs next.
 */
export function throwIfNotAgent(res: StatusOnly | null): void {
  if (!res) {
    throw new Response("The agent portal could not confirm who is signed in.", {
      status: 503,
      statusText: "Service Unavailable",
    });
  }
  if (res.status === 403) throw redirect("/");
  if (res.status === 401) throw redirect("/agent-login");
}
