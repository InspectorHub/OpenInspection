/**
 * BFF resource route for a contact's live report links (IA-100).
 *
 * The archive dialog needs this count the moment it opens, for ONE contact —
 * loading it for every row of the contacts list up front would cost a query
 * per contact to answer a question asked about one of them.
 *
 * It exists at all because client code must not call /api directly: the
 * browser never holds the JWT (Token-Relay BFF), so a `fetch('/api/...')`
 * from a component is simply unauthenticated. The loader holds the cookie and
 * forwards it.
 */
import type { Route } from "./+types/contact-access";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return { access: [], archiveRevokesAccess: false };

  try {
    const api = createApi(context, { token });
    // Both halves of the same question. The dialog has to say what archiving
    // WILL do, which is the access list plus the tenant's policy toward it —
    // fetching the policy separately would let the two disagree on screen.
    const [res, ctxRes] = await Promise.all([
      api.contacts[":id"].access.$get({ param: { id } }),
      api.sessionContext.context.$get().catch(() => null),
    ]);

    let archiveRevokesAccess = false;
    if (ctxRes?.ok) {
      const cb = (await ctxRes.json()) as { data?: { branding?: { archiveRevokesAccess?: boolean } } };
      archiveRevokesAccess = cb.data?.branding?.archiveRevokesAccess ?? false;
    }

    if (!res.ok) return { access: [], archiveRevokesAccess };
    const body = (await res.json()) as { data?: { access?: unknown[] } };
    return { access: body.data?.access ?? [], archiveRevokesAccess };
  } catch {
    // An empty list is the safe render here — the dialog falls back to its
    // plain confirmation rather than showing a count it could not verify.
    return { access: [], archiveRevokesAccess: false };
  }
}
