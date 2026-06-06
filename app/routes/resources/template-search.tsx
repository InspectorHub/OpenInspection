/**
 * BFF resource route for TemplateCombobox: lazy-loads templates with optional
 * search query and pagination, avoiding any direct client-side API fetches.
 */
import type { Route } from "./+types/template-search";
import { getToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";

interface TemplateSummary {
    id: string;
    name: string;
}

export async function loader({ request, context }: Route.LoaderArgs) {
    const token = await getToken(context, request);
    if (!token) return { templates: [] as TemplateSummary[], hasMore: false, page: 1, totalPages: 1 };

    const url = new URL(request.url);
    const q = url.searchParams.get("q") ?? "";
    const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));

    const api = createApi(context, { token });
    const hdr = { headers: { "x-token-relay": "1" } } as const;

    const res = await api.inspections.templates.$get({
        query: { page: String(page), pageSize: "25", ...(q ? { q } : {}) },
    }, hdr).catch(() => null);

    if (!res?.ok) return { templates: [] as TemplateSummary[], hasMore: false, page: 1, totalPages: 1 };

    const body = (await res.json()) as {
        data?: TemplateSummary[];
        meta?: { page: number; totalPages: number };
    };

    const templates = (body.data ?? []).map(t => ({ id: t.id, name: t.name }));
    const meta = body.meta;

    return {
        templates,
        hasMore: meta ? meta.page < meta.totalPages : false,
        page: meta?.page ?? 1,
        totalPages: meta?.totalPages ?? 1,
    };
}
