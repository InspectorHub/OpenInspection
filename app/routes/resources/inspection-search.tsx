/**
 * BFF resource route for dashboard inspection search: server-side full-text
 * search across all inspections (not just the loaded bucket subset).
 */
import type { Route } from "./+types/inspection-search";
import { getToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";

export interface InspectionSearchItem {
    id: string;
    address: string;
    propertyAddress: string;
    clientName: string | null;
    clientEmail: string | null;
    status: string;
    date: string | null;
}

export async function loader({ request, context }: Route.LoaderArgs) {
    const token = await getToken(context, request);
    if (!token) return { inspections: [] as InspectionSearchItem[], hasMore: false, nextCursor: null as string | null };

    const url = new URL(request.url);
    const q = url.searchParams.get("q") ?? "";
    const cursor = url.searchParams.get("cursor") ?? "";

    const api = createApi(context, { token });
    const hdr = { headers: { "x-token-relay": "1" } } as const;

    const query: Record<string, string> = { limit: "25" };
    if (q) query.search = q;
    if (cursor) query.cursor = cursor;

    const res = await api.inspections.index.$get({ query }, hdr).catch(() => null);

    if (!res?.ok) return { inspections: [] as InspectionSearchItem[], hasMore: false, nextCursor: null as string | null };

    const body = (await res.json()) as {
        data?: Array<{ id: string; propertyAddress: string; clientName: string | null; clientEmail: string | null; status: string; date: string | null }>;
        meta?: { nextCursor?: string | null };
    };

    const inspections: InspectionSearchItem[] = (body.data ?? []).map(r => ({
        id: r.id,
        address: r.propertyAddress,
        propertyAddress: r.propertyAddress,
        clientName: r.clientName ?? null,
        clientEmail: r.clientEmail ?? null,
        status: r.status,
        date: r.date ?? null,
    }));

    return {
        inspections,
        hasMore: !!body.meta?.nextCursor,
        nextCursor: body.meta?.nextCursor ?? null,
    };
}
