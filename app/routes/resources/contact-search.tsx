/**
 * BFF resource route for the command palette's `@` people prefix.
 *
 * F64 — the palette advertised `@ people` on its own hint row and answered
 * every such query with "No results found", because the only search it ran was
 * over the handful of recent inspections it had already loaded. The code said
 * `sources = []; // contacts would need a search endpoint`.
 *
 * It did not need one. `GET /api/contacts` has taken a `search` parameter all
 * along (`ContactListQuerySchema`), and `ContactService.listContacts` resolves
 * it as a real query against the contacts table. What was missing was this
 * route: engine `app/` code never calls `/api/*` directly (CLAUDE.md — the
 * token-relay BFF owns the JWT), so a component that wants server-side search
 * needs a loader to ask through.
 *
 * Narrow on purpose. It returns the four fields a palette row can show and
 * nothing else — no counts, no archived rows, no second page — so that it
 * cannot quietly become a second contacts list endpoint with its own opinions.
 */
import type { Route } from "./+types/contact-search";
import { getToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";

export interface ContactSearchItem {
    id: string;
    name: string;
    type: "agent" | "client" | "other";
    email: string | null;
}

/** A palette page of results. Ten, because the palette shows three other groups
 *  above this one and a long list pushes them off the visible area. */
const LIMIT = "10";

export async function loader({ request, context }: Route.LoaderArgs): Promise<{ contacts: ContactSearchItem[] }> {
    const token = await getToken(context, request);
    if (!token) return { contacts: [] };

    // An empty `q` is a real question, not a missing one: typing `@` alone means
    // "show me my contacts", and the API answers that with its first page.
    const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";

    const api = createApi(context, { token });
    const query: Record<string, string> = { limit: LIMIT };
    if (q) query.search = q;

    const res = await api.contacts.index
        .$get({ query }, { headers: { "x-token-relay": "1" } })
        .catch(() => null);
    if (!res?.ok) return { contacts: [] };

    const body = (await res.json()) as {
        data?: Array<{ id: string; name: string; type: "agent" | "client" | "other"; email: string | null }>;
    };

    return {
        contacts: (body.data ?? []).map((c) => ({
            id: c.id,
            name: c.name,
            type: c.type,
            email: c.email ?? null,
        })),
    };
}
