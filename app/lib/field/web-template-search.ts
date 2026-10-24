/**
 * The web host's `resources.templateSearch`: the template picker's search over the BFF resource route
 * `/resources/template-search` (loader = GET `?page=&q=`, 25 rows a page).
 *
 * Never throws. A failed, unauthenticated, redirected or malformed read answers an empty single page, which is
 * what the route itself answers when it cannot read the templates.
 */
import type { FieldResources } from "@core/field-ui/data-source";
import type { TemplateSearchResult, TemplateSummary } from "@core/field-ui/data-source-types";

const TEMPLATE_SEARCH_ROUTE = "/resources/template-search";

type TemplateSearch = NonNullable<FieldResources["templateSearch"]>;

const emptyPage = (): TemplateSearchResult => ({ templates: [], hasMore: false, page: 1, totalPages: 1 });

export function createWebTemplateSearch(fetchImpl: typeof fetch = (input, init) => fetch(input, init)): TemplateSearch {
    return {
        async search({ q, page }): Promise<TemplateSearchResult> {
            const params = new URLSearchParams({ page: String(page) });
            if (q) params.set("q", q);
            try {
                const res = await fetchImpl(`${TEMPLATE_SEARCH_ROUTE}?${params}`, { credentials: "include", headers: { accept: "application/json" } });
                if (!res.ok || res.redirected) return emptyPage();
                if (!res.headers.get("content-type")?.toLowerCase().includes("json")) return emptyPage();
                const body = (await res.json().catch(() => null)) as Partial<TemplateSearchResult> | null;
                if (body === null || typeof body !== "object" || !Array.isArray(body.templates)) return emptyPage();
                return {
                    templates: body.templates as TemplateSummary[],
                    hasMore: body.hasMore === true,
                    page: typeof body.page === "number" ? body.page : 1,
                    totalPages: typeof body.totalPages === "number" ? body.totalPages : 1,
                };
            } catch {
                return emptyPage();
            }
        },
    };
}
