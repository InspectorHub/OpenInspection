/**
 * Track H — BFF resource route for the canned-comments library (C-12).
 *
 * The editor's comment hooks used to hit `/api/admin/comments` with raw
 * client fetch(), which only worked because the session cookie happened to
 * ride along (the documented Token-Relay rule: client code never fetches
 * `/api` directly). This route is the relay: loader = search/list, action =
 * save-snippet / touch-usage.
 *
 * No UI — resource route (loader/action only).
 */
import type { Route } from "./+types/comments-library";
import { getToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";

export interface LibraryComment {
    id: string;
    text: string;
    category: string | null;
    severity: string | null;
    section: string | null;
    libraryId?: string | null;
    useCount?: number;
}

const QUERY_KEYS = ["search", "sort", "filterMode", "itemLabel", "section", "severity", "pageSize"] as const;

export async function loader({ request, context }: Route.LoaderArgs) {
    const token = await getToken(context, request);
    if (!token) return { comments: [] as LibraryComment[] };

    const url = new URL(request.url);
    const query: Record<string, string> = {};
    for (const k of QUERY_KEYS) {
        const v = url.searchParams.get(k);
        if (v) query[k] = v;
    }

    const api = createApi(context, { token });
    try {
        const res = await api.admin.comments.$get(
            { query },
            { headers: { "x-token-relay": "1" } },
        );
        if (!res.ok) return { comments: [] as LibraryComment[] };
        const body = (await res.json()) as { data?: LibraryComment[] };
        return { comments: body.data ?? [] };
    } catch {
        return { comments: [] as LibraryComment[] };
    }
}

export async function action({ request, context }: Route.ActionArgs) {
    const token = await getToken(context, request);
    if (!token) return { ok: false as const };
    const api = createApi(context, { token });
    const form = await request.formData();
    const intent = String(form.get("intent") ?? "");

    try {
        if (intent === "touch") {
            const id = String(form.get("id") ?? "");
            if (!id) return { ok: false as const };
            const res = await api.admin.comments[":id"].touch.$post(
                { param: { id } },
                { headers: { "x-token-relay": "1" } },
            );
            return { ok: res.ok };
        }

        if (intent === "save" || intent === "edit") {
            const text = String(form.get("text") ?? "").trim();
            if (!text) return { ok: false as const };
            const rawSeverity = String(form.get("severity") ?? "");
            const SEVERITIES = ["good", "marginal", "significant", "minor"] as const;
            const severity = (SEVERITIES as readonly string[]).includes(rawSeverity)
                ? (rawSeverity as (typeof SEVERITIES)[number])
                : null;
            const section = String(form.get("section") ?? "");
            const category = String(form.get("category") ?? "");
            const itemLabel = String(form.get("itemLabel") ?? "");
            const numOrNull = (k: string) => {
                const v = String(form.get(k) ?? "");
                return v ? Number(v) : null;
            };
            const json = {
                text,
                severity,
                section: section || null,
                category: category || null,
                itemLabel: itemLabel || null,
                repairSummary: String(form.get("repairSummary") ?? "") || null,
                estimateMinCents: numOrNull("estimateMinCents"),
                estimateMaxCents: numOrNull("estimateMaxCents"),
                recommendedContractorTypeId: String(form.get("recommendedContractorTypeId") ?? "") || null,
            };
            const res = intent === "edit"
                ? await api.admin.comments[":id"].$put(
                    { param: { id: String(form.get("id") ?? "") }, json },
                    { headers: { "x-token-relay": "1" } },
                )
                : await api.admin.comments.$post(
                    { json },
                    { headers: { "x-token-relay": "1" } },
                );
            return { ok: res.ok };
        }
    } catch {
        return { ok: false as const };
    }
    return { ok: false as const };
}
