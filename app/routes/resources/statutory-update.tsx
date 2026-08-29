/**
 * BFF resource route for the statutory package update: read the cost, then pay
 * it.
 *
 * Both halves in one file because they are one decision. The loader counts the
 * inspections already under way — how many keep producing their form and how
 * many cannot — and the action performs the update the reader then approved.
 * Splitting them would let the confirmation drift away from the thing it
 * confirms.
 *
 * Everything goes through the token-relay API client. A raw `fetch('/api/…')`
 * from the browser carries no session and would 401.
 */
import type { Route } from "./+types/statutory-update";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import type { StatutoryUpdateImpact } from "../../../server/services/marketplace/statutory-update-impact";

/** Neither endpoint is on the typed client surface; reach them the way the other marketplace action routes do. */
type StatutoryClient = {
    [":id"]: {
        "statutory-update": {
            impact: { $get: (args: { param: { id: string } }) => Promise<Response> };
        };
        update: { $post: (args: { param: { id: string } }) => Promise<Response> };
    };
};

export async function loader({ request, context }: Route.LoaderArgs) {
    const token = await requireToken(context, request);
    const id = new URL(request.url).searchParams.get("libraryId") ?? "";
    if (!id) return { ok: false as const, impact: null };

    const api = createApi(context, { token }) as unknown as { marketplace: StatutoryClient };
    const res = await api.marketplace[":id"]["statutory-update"].impact.$get({ param: { id } });
    // A failure is reported rather than defaulted. Zeroes here would read as
    // "this update costs nothing", which is the one thing a reader must not be
    // told by accident.
    if (!res.ok) return { ok: false as const, impact: null };
    const body = (await res.json()) as { data?: StatutoryUpdateImpact };
    return { ok: true as const, impact: body.data ?? null };
}

export async function action({ request, context }: Route.ActionArgs) {
    const token = await requireToken(context, request);
    const form = await request.formData();
    const raw = form.get("libraryId");
    const id = typeof raw === "string" ? raw : "";
    if (!id) return { ok: false as const };

    const api = createApi(context, { token }) as unknown as { marketplace: StatutoryClient };
    const res = await api.marketplace[":id"].update.$post({ param: { id } });
    if (!res.ok) return { ok: false as const };
    const body = (await res.json()) as { data?: { newLocalId?: string } };
    return { ok: true as const, newLocalId: body.data?.newLocalId ?? null };
}
