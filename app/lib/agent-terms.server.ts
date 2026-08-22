import { redirect } from "react-router";

/**
 * Turn the agent-terms gate's refusal into the screen that resolves it.
 *
 * `server/lib/middleware/agent-terms-gate.ts` answers 428 with
 * `AGENT_TERMS_REQUIRED` for every authenticated agent request until the account
 * holds an acceptance of the terms in force. That is the enforcement. This is
 * only the redirect — a loader that forgets to call it leaves an agent on a page
 * with no data, never on a page with data they should not have.
 *
 * The code is checked, not just the status. 428 means this and nothing else in
 * this API today, and reading the body is what keeps that true the day it does
 * not: a different 428 falls through and the caller handles it as the failure it
 * is, rather than sending someone to a consent screen for an unrelated reason.
 *
 * Reading the body consumes the response, which is safe precisely because this
 * path throws — no caller gets it back to read again.
 */
/**
 * Accepts the structural minimum it actually reads — a status and a JSON body —
 * rather than `Response`. The typed Hono client returns `ClientResponse`, which
 * is not a `Response` (no `webSocket`), so demanding the DOM type here forced
 * every caller to widen a value the client had typed precisely.
 */
type StatusAndJson = { status: number; json(): Promise<unknown> };

/**
 * The URL a human can actually be sent to.
 *
 * This gate fires inside `agent-layout`'s loader, and React Router calls a
 * loader through a DATA request: `/agent-dashboard` is fetched as
 * `/agent-dashboard.data?_routes=…`. Carrying that straight into `returnTo`
 * sends the agent, after accepting, to a URL that renders no page — a 404 at
 * the end of the one screen that unblocks them. Verified in a browser; the
 * suite could not see it because every request it built was already a page URL.
 *
 * Strips only what React Router adds, and nothing else: a real path that merely
 * looks data-ish (`/agent-reports/metadata`) must survive, which is why the
 * suffix check is exact rather than a substring match.
 */
function pageUrlFor(url: URL): string {
  let pathname = url.pathname;
  if (pathname.endsWith(".data")) {
    pathname = pathname.slice(0, -".data".length);
    // React Router addresses the root route as `/_root.data`.
    if (pathname === "" || pathname === "/_root") pathname = "/";
  }
  const search = new URLSearchParams(url.search);
  search.delete("_routes");
  const query = search.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export async function throwIfAgentTermsRequired(
  res: StatusAndJson,
  request: Request,
): Promise<void> {
  if (res.status !== 428) return;

  const body = (await res.json().catch(() => ({}))) as {
    error?: { code?: string; details?: { acceptPath?: string } };
  };
  if (body.error?.code !== "AGENT_TERMS_REQUIRED") return;

  // The path comes from the refusal rather than being assumed here: it is the
  // deployment's page, and the gate is the thing that knows where it is.
  const acceptPath = body.error.details?.acceptPath ?? "/agent-accept-terms";
  const returnTo = pageUrlFor(new URL(request.url));
  throw redirect(`${acceptPath}?returnTo=${encodeURIComponent(returnTo)}`);
}
