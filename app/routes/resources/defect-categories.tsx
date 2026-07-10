/**
 * Authoring unification Plan-4 (module K) — BFF resource route for the
 * account-level defect-category manager. Mirrors `resources/comments-library.tsx`:
 * loader = list (seeds on first read via the admin API's `ensureSeed`), action =
 * save (create) / edit (update) / delete, all Token-Relayed to the in-process API.
 *
 * No UI — resource route (loader/action only).
 */
import type { Route } from "./+types/defect-categories";
import { getToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";

export interface DefectCategoryRow {
    id: string;
    name: string;
    color: string;
    drivesSummary: boolean;
    sortOrder: number;
    isSeed: boolean;
}

export async function loader({ request, context }: Route.LoaderArgs) {
    const token = await getToken(context, request);
    if (!token) return { categories: [] as DefectCategoryRow[] };

    const api = createApi(context, { token });
    try {
        const res = await api.defectCategories["defect-categories"].$get(
            {},
            { headers: { "x-token-relay": "1" } },
        );
        if (!res.ok) return { categories: [] as DefectCategoryRow[] };
        const body = (await res.json()) as { data?: DefectCategoryRow[] };
        return { categories: body.data ?? [] };
    } catch {
        return { categories: [] as DefectCategoryRow[] };
    }
}

export async function action({ request, context }: Route.ActionArgs) {
    const token = await getToken(context, request);
    if (!token) return { ok: false as const };
    const api = createApi(context, { token });
    const form = await request.formData();
    const intent = String(form.get("intent") ?? "");

    try {
        if (intent === "delete") {
            const id = String(form.get("id") ?? "");
            if (!id) return { ok: false as const };
            const res = await api.defectCategories["defect-categories"][":id"].$delete(
                { param: { id } },
                { headers: { "x-token-relay": "1" } },
            );
            return { ok: res.ok };
        }

        if (intent === "save" || intent === "edit") {
            const name = String(form.get("name") ?? "").trim();
            if (!name) return { ok: false as const };
            const color = String(form.get("color") ?? "") || undefined;
            const drivesSummary = form.get("drivesSummary") === "true";
            const rawSortOrder = String(form.get("sortOrder") ?? "");
            const sortOrder = rawSortOrder ? Number(rawSortOrder) : undefined;
            const json = { name, color, drivesSummary, sortOrder };

            const res = intent === "edit"
                ? await api.defectCategories["defect-categories"][":id"].$put(
                    { param: { id: String(form.get("id") ?? "") }, json },
                    { headers: { "x-token-relay": "1" } },
                )
                : await api.defectCategories["defect-categories"].$post(
                    { json },
                    { headers: { "x-token-relay": "1" } },
                );
            if (!res.ok) {
                const errBody = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
                return { ok: false as const, error: errBody?.error?.message };
            }
            return { ok: true as const };
        }
    } catch {
        return { ok: false as const };
    }
    return { ok: false as const };
}
