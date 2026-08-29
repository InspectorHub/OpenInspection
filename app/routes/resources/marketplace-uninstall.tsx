/**
 * BFF resource route for un-installing a catalogue entry.
 *
 * The counterpart of `marketplace-install.tsx`, and the reason it exists is
 * plainer than usual: the service method it reaches had no caller of any kind,
 * so a workspace could install a pack and never take it out of service, while
 * the template picker's own copy told inspectors to ask an administrator to
 * reinstall something no administrator could uninstall in the first place.
 *
 * Everything goes through the token-relay API client. A raw `fetch('/api/…')`
 * from the browser carries no session and would 401.
 */
import type { Route } from "./+types/marketplace-uninstall";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";

/** Not on the typed client surface; reached the way the other marketplace action routes reach theirs. */
type UninstallClient = {
    [":id"]: { uninstall: { $post: (args: { param: { id: string } }) => Promise<Response> } };
};

export async function action({ request, context }: Route.ActionArgs) {
    const token = await requireToken(context, request);
    const form = await request.formData();
    const raw = form.get("libraryId");
    const id = typeof raw === "string" ? raw : "";
    if (!id) return { ok: false as const };

    const api = createApi(context, { token }) as unknown as { marketplace: UninstallClient };
    const res = await api.marketplace[":id"].uninstall.$post({ param: { id } });
    // Reported rather than defaulted: a caller told "ok" about a refusal would
    // show a pack as removed while every row it created was still there.
    if (!res.ok) return { ok: false as const };
    const body = (await res.json()) as { data?: { kind?: string; rowsAffected?: number } };
    return {
        ok: true as const,
        kind: body.data?.kind ?? null,
        rowsAffected: body.data?.rowsAffected ?? 0,
    };
}
