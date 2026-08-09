/**
 * BFF resource route for agreement TEMPLATE authoring (#67).
 *
 * WHY THIS FILE EXISTS AT ALL. The template CRUD shipped complete on the
 * server — `POST /agreements`, `PUT /agreements/{id}`, `DELETE /agreements/{id}`,
 * each `requireRole('owner','manager')`, each sanitising the body through
 * `sanitizeAgreementHtml()` — and a grep of `app/` for any of the three came
 * back empty. The Library page listed templates and offered a "+ New agreement"
 * button carrying no handler, beside per-row "Edit" buttons carrying no handler.
 * A workspace could read the agreement it was seeded with and could not change
 * a word of it. This route is the front door.
 *
 * A client `fetch('/api/...')` arrives UNAUTHENTICATED in this repository — the
 * JWT is a server-held cookie — so the browser talks to this route and this
 * route relays the token to the in-process API.
 *
 * ⚠️ THE SERVER IS THE SANITISING BOUNDARY, AND THIS ROUTE DOES NOT DUPLICATE
 * IT. `agreementService.createAgreement/updateAgreement` run every body through
 * `sanitizeAgreementHtml()` before it reaches D1. The editor converges its own
 * output onto a subset of that allow-list first (`app/lib/agreement-markup.ts`)
 * so the author is not shown a document the boundary will edit — but this route
 * forwards what it is given, unaltered. A second, differently-written cleanup
 * in the middle would be a third opinion about what an agreement may contain,
 * and the one that matters would no longer be the one that runs last.
 *
 * WHAT IT DOES REFUSE is an EMPTY body. `content` is `.min(1)` in the API's Zod
 * schema, so an empty create is a 400 the UI can only render as a generic
 * failure; and on the PUT path an empty string is worse than a 400, because
 * `AgreementSchema.partial()` treats "" as a value the caller meant — the
 * service sanitises it to "" and stores it, silently blanking a live agreement.
 * Emptiness is decided on the TEXT, not the markup: `<p><br></p>` is what a
 * cleared contenteditable serialises to and contains no agreement at all.
 */
import type { Route } from "./+types/agreement-templates";
import { getToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { agreementHtmlIsEmpty } from "~/lib/agreement-markup";
import { m } from "~/paraglide/messages";

/** Where consumers post; kept beside the handler so the two cannot drift. */
export const AGREEMENT_TEMPLATES_ACTION = "/resources/agreement-templates";

/** The editable shape of one template. `version` is server-owned. */
export interface AgreementTemplateDraft {
    id: string;
    name: string;
    content: string;
}

export type AgreementTemplateLoadResult =
    | { ok: true; template: AgreementTemplateDraft }
    | { ok: false; error: string };

export type AgreementTemplateSaveResult =
    | { ok: true; intent: string; id: string }
    | { ok: false; intent: string; error: string };

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
 * GET /resources/agreement-templates?id=<agreementId>
 *
 * Read-only. Fetches ONE template's body for the editor.
 *
 * There is no GET-one endpoint on the server — the admin router exposes list,
 * create, update and delete and nothing else — so this selects from the
 * tenant-scoped list rather than pretending an endpoint exists. The list is
 * already filtered by `tenantId` server-side, so an id belonging to another
 * workspace simply is not in it and falls through to the refusal below.
 */
export async function loader({ request, context }: Route.LoaderArgs): Promise<AgreementTemplateLoadResult> {
    const failed = m.library_agreement_editor_err_load();
    const url = new URL(request.url);
    const id = url.searchParams.get("id") ?? "";

    const token = await getToken(context, request);
    if (!token || !id) return { ok: false, error: failed };

    const api = createApi(context, { token });
    try {
        const res = await api.admin.agreements.$get();
        if (!res.ok) return { ok: false, error: await apiErrorMessage(res, failed) };
        const body = (await res.json()) as { data?: Array<{ id: string; name?: string; content?: string }> };
        const row = (body.data ?? []).find((t) => t.id === id);
        // ⚠️ NOT `{ content: "" }`. An unknown id opening a blank editor is how
        // a save overwrites a real agreement with nothing — the author would
        // have no way to tell "this template is empty" from "we did not find
        // it".
        if (!row) return { ok: false, error: failed };
        return { ok: true, template: { id: row.id, name: row.name ?? "", content: row.content ?? "" } };
    } catch {
        return { ok: false, error: failed };
    }
}

/**
 * POST /resources/agreement-templates
 *
 * Fields: `intent` (`create` | `update` | `delete`), plus `id` for the latter
 * two and `name` / `content` for the first two.
 */
export async function action({ request, context }: Route.ActionArgs): Promise<AgreementTemplateSaveResult> {
    const form = await request.formData();
    const intent = String(form.get("intent") ?? "");
    const failed = intent === "delete"
        ? m.library_agreement_editor_err_delete()
        : m.library_agreement_editor_err_save();

    const token = await getToken(context, request);
    if (!token) return { ok: false, intent, error: failed };

    const id = String(form.get("id") ?? "").trim();
    const name = String(form.get("name") ?? "").trim();
    const content = String(form.get("content") ?? "");
    const api = createApi(context, { token });

    if (intent === "create" || intent === "update") {
        if (!name) return { ok: false, intent, error: m.library_agreement_editor_err_name_required() };
        if (agreementHtmlIsEmpty(content)) {
            return { ok: false, intent, error: m.library_agreement_editor_err_body_required() };
        }
        if (intent === "update" && !id) return { ok: false, intent, error: failed };

        try {
            const res = intent === "create"
                ? await api.admin.agreements.$post({ json: { name, content } })
                : await api.admin.agreements[":id"].$put({ param: { id }, json: { name, content } });
            if (!res.ok) return { ok: false, intent, error: await apiErrorMessage(res, failed) };
            const body = (await res.json()) as { data?: { agreement?: { id?: string } } };
            // The create path is the only one that learns a new id; the update
            // path already knows the one it addressed.
            const savedId = body.data?.agreement?.id ?? id;
            if (!savedId) return { ok: false, intent, error: failed };
            return { ok: true, intent, id: savedId };
        } catch {
            return { ok: false, intent, error: failed };
        }
    }

    if (intent === "delete") {
        if (!id) return { ok: false, intent, error: failed };
        try {
            const res = await api.admin.agreements[":id"].$delete({ param: { id } });
            if (!res.ok) return { ok: false, intent, error: await apiErrorMessage(res, failed) };
            return { ok: true, intent, id };
        } catch {
            return { ok: false, intent, error: failed };
        }
    }

    return { ok: false, intent, error: failed };
}
