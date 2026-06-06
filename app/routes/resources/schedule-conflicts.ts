/**
 * IA-6 — BFF resource route for advisory schedule-conflict detection.
 *
 * Loaded via useFetcher in NewInspectionWizard when both an inspector and
 * date/time are chosen. Returns conflicts for the proposed slot so the
 * wizard can render a non-blocking yellow warning.
 *
 * BFF rule: all API calls go through createApi() on the server; the browser
 * never calls /api/* directly.
 */
import type { AppLoadContext } from "react-router";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";

export async function loader({
    request,
    context,
}: {
    request: Request;
    context: AppLoadContext;
}) {
    const token = await requireToken(context, request);
    const api = createApi(context, { token });
    const url = new URL(request.url);
    const inspectorId = url.searchParams.get("inspectorId") ?? "";
    const date = url.searchParams.get("date") ?? "";
    const excludeId = url.searchParams.get("excludeId") ?? undefined;

    if (!date) return { conflicts: [] };

    const res = await api.inspections["schedule-conflicts"]
        .$get({
            query: {
                // Omitted inspectorId = check the caller (solo wizard flow
                // assigns the inspection to its creator).
                ...(inspectorId ? { inspectorId } : {}),
                date,
                ...(excludeId ? { excludeId } : {}),
            },
        })
        .catch(() => null);

    // Advisory feature: API failures intentionally yield an empty result so the
    // wizard stays unblocked. Check API logs server-side for details on failures.
    if (!res?.ok) return { conflicts: [] };

    const body = (await res.json()) as {
        data?: {
            conflicts?: Array<{
                inspectionId: string;
                propertyAddress: string;
                date: string;
            }>;
        };
    };
    return { conflicts: body.data?.conflicts ?? [] };
}
