import type { createApi } from "~/lib/api-client.server";

/**
 * The editor's two writes that exist only because a template produces an
 * authority's form.
 *
 * ── WHY THEY LEFT `action.server.ts` ────────────────────────────────────────
 * That file is a flat chain of thirty intents at its 400-line ceiling, and
 * these two are the one group in it that shares a reason to exist rather than a
 * shape: both write something no ordinary inspection has, and both are read by
 * somebody asking "what does this form still need". Splitting on that line was
 * better than raising a baseline.
 *
 * ── ONE ENTRY POINT, `null` FOR "NOT MINE" ──────────────────────────────────
 * A returned `null` means this module did not recognise the intent, so the
 * caller carries on down its chain. That is deliberately distinguishable from a
 * handled intent that failed, which returns `{ ok: false }` — a module that
 * answered `null` on a write it owns would let the request fall through to the
 * bottom of the action and return `{ ok: true }`, which is exactly the silent
 * data loss the surrounding file's own comment warns about.
 */
type Api = ReturnType<typeof createApi>;

export type StatutoryActionResult =
    | { ok: boolean; intent: "save-statutory-details" }
    | { ok: true }
    | { error: string };

export async function handleStatutoryIntent(
    intent: string,
    formData: FormData,
    api: Api,
    id: string,
): Promise<StatutoryActionResult | null> {
    // The inspection-level answers the form asks for. The WHOLE set travels
    // every time, so the panel's single fetcher is abort-safe: a later submit is
    // a superset of any in-flight one. The server reads an absent key as "leave
    // it alone", which is what makes a partial payload safe as well.
    if (intent === "save-statutory-details") {
        const payload = JSON.parse(String(formData.get("payload") ?? "{}"));
        const res = await api.inspections[":id"]["statutory-details"].$patch({
            param: { id },
            json: payload,
        });
        return { ok: res.ok, intent: "save-statutory-details" };
    }

    // An instance the authority's page has no slot to print. Printed slots are
    // ordinary items and save through the normal results path; only what the
    // item model cannot hold comes through here.
    if (intent === "add-statutory-instance") {
        const res = await (api.inspections[":id"] as unknown as {
            "statutory-form": { instances: { $post: (a: unknown) => Promise<Response> } };
        })["statutory-form"].instances.$post({
            param: { id },
            json: {
                groupId: String(formData.get("groupId") ?? ""),
                index: Number(formData.get("index") ?? 0),
                fields: JSON.parse(String(formData.get("fields") ?? "{}")),
            },
        });
        if (!res.ok) {
            // Surfaced rather than swallowed: the one refusal this can raise
            // names a slot the form prints, and that is something the person
            // needs to read.
            const body = await res.json().catch(() => null) as { error?: { message?: string } } | null;
            return { error: body?.error?.message ?? "Could not record that instance." };
        }
        return { ok: true };
    }

    return null;
}
