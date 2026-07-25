import type { createApi } from "~/lib/api-client.server";

/** A contact row as a typeahead needs it. Phone is null for agents, who have no field for it. */
export interface TypeaheadContact {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
}

/**
 * Look up contacts for a wizard typeahead.
 *
 * The People step searches the same table twice — agents (since IA-1) and now
 * clients — through the same endpoint with the same debounce, limit and minimum
 * query length. Written out twice in the route action, the second copy is the one
 * that misses the next fix, so both intents call this.
 *
 * Under two characters it returns nothing rather than querying: the client field
 * is also the name field, so it receives a keystroke per letter of every new
 * client's name, and one-letter searches would match most of the table.
 */
export async function searchContactsForTypeahead(
    api: ReturnType<typeof createApi>,
    type: "agent" | "client",
    search: string,
): Promise<TypeaheadContact[]> {
    if (search.length < 2) return [];
    const res = await api.contacts.index.$get({ query: { type, search, limit: "8" } }).catch(() => null);
    if (!res || !res.ok) return [];
    const body = (await res.json().catch(() => ({ data: [] }))) as {
        data?: Array<{ id: string; name: string; email: string | null; phone?: string | null }>;
    };
    return (body.data ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        email: c.email,
        phone: c.phone ?? null,
    }));
}
