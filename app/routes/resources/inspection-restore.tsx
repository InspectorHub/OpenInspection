/**
 * BFF resource route for bringing a cancelled inspection back (#81).
 *
 * WHY THIS FILE EXISTS. `POST /api/inspections/:id/uncancel` shipped complete
 * and unwired — a grep of `app/` for the path came back empty. The product's
 * only recovery was the list row's status dropdown, which PATCHed a plain
 * status and lived nowhere near the place people actually cancel from (the
 * hub's Lifecycle card). So there were two write paths for one idea and no
 * discoverable door for either. This route is the single front door, consumed
 * by both surfaces through the same component.
 *
 * A client `fetch('/api/...')` arrives UNAUTHENTICATED — the JWT is a
 * server-held cookie — so the browser talks to this route and this route relays
 * the token to the in-process API.
 *
 * ⚠️ RESTORING IS NOT AN UNDO, and nothing here may imply otherwise. The
 * inspection returns to `scheduled` and the recorded cancellation reason is
 * cleared; the fee that was kept and the refund that was issued are already
 * ledger entries and stay exactly where they are. Every string this route's
 * callers render says both halves.
 */
import type { Route } from "./+types/inspection-restore";
import { getToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { m } from "~/paraglide/messages";

export type RestoreInspectionResult = { ok: true } | { ok: false; error: string };

/** Pull the API's own refusal text out of an error envelope, if it sent one. */
async function apiErrorMessage(
    res: { json: () => Promise<unknown> },
    fallback: string,
): Promise<string> {
    try {
        const body = (await res.json()) as { error?: { message?: string } };
        const message = body?.error?.message;
        return typeof message === "string" && message.trim() ? message : fallback;
    } catch {
        return fallback;
    }
}

/**
 * POST /resources/inspection-restore — field: `id`.
 *
 * No loader. There is nothing to price and nothing to preview: unlike the
 * cancel direction, the outcome does not depend on a policy ladder or on how
 * much notice was given. What it does is the same sentence every time, which is
 * why the confirmation can be static copy rather than a fetched quote.
 */
export async function action({ request, context }: Route.ActionArgs): Promise<RestoreInspectionResult> {
    const failed = m.inspections_hub_restore_failed();
    const token = await getToken(context, request);
    if (!token) return { ok: false, error: failed };

    const form = await request.formData();
    const id = String(form.get("id") ?? "");
    if (!id) return { ok: false, error: failed };

    const api = createApi(context, { token });
    try {
        const res = await api.inspections[":id"].uncancel.$post(
            { param: { id } },
            { headers: { "x-token-relay": "1" } },
        );
        // 400 covers the one refusal that matters here: the inspection is not
        // cancelled. That is a stale screen rather than a failure, and the API's
        // own wording says so more precisely than a generic retry line would.
        if (!res.ok) return { ok: false, error: await apiErrorMessage(res, failed) };
        return { ok: true };
    } catch {
        return { ok: false, error: failed };
    }
}
