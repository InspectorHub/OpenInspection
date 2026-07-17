/**
 * BFF resource route for the availability heatmap strip.
 *
 * The calendar keeps its visible week in client state, so the page loader
 * cannot know which week to summarize; the strip loads this route via
 * useFetcher whenever the visible week changes.
 *
 * BFF rule: all API calls go through createApi() on the server; the browser
 * never calls /api/* directly.
 */
import type { AppLoadContext } from "react-router";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import type { HeatmapDay } from "~/components/settings/AvailabilityHeatmapWeek";

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
    const start = url.searchParams.get("start") ?? "";
    const userId = url.searchParams.get("userId") ?? undefined;

    if (!start) return { days: [] as HeatmapDay[] };

    const res = await api.schedule["week-summary"]
        .$get({ query: { start, ...(userId ? { userId } : {}) } })
        .catch(() => null);

    // The strip is decorative: a failure hides it rather than breaking the
    // calendar. Check API logs server-side for details on failures.
    if (!res?.ok) return { days: [] as HeatmapDay[] };

    const body = (await res.json()) as { data?: { days?: HeatmapDay[] } };
    return { days: body.data?.days ?? [] };
}
