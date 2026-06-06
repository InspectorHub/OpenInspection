/**
 * C-12 — BFF resource route for InspectionSettingsSheet component.
 *
 * loader: bundles GET /api/inspections/:id + /api/inspections/templates +
 *         /api/team/members into one server call so the component has no
 *         raw client-side fetches.
 */
import type { Route } from "./+types/inspection-settings-sheet";
import { getToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";

interface Template {
    id: string;
    name: string;
}

interface Member {
    id: string;
    email: string;
    role: string;
}

export async function loader({ request, context }: Route.LoaderArgs) {
    const token = await getToken(context, request);
    if (!token) return { inspection: null, templates: [] as Template[], members: [] as Member[] };

    const url = new URL(request.url);
    const inspectionId = url.searchParams.get("inspectionId") ?? "";
    if (!inspectionId) return { inspection: null, templates: [] as Template[], members: [] as Member[] };

    const api = createApi(context, { token });
    const hdr = { headers: { "x-token-relay": "1" } } as const;

    const [inspRes, tplRes, membersRes] = await Promise.all([
        api.inspections[":id"].$get({ param: { id: inspectionId } }, hdr).catch(() => null),
        api.inspections.templates.$get({ query: { page: "1", pageSize: "200" } }, hdr).catch(() => null),
        api.team.members.$get({}, hdr).catch(() => null),
    ]);

    let inspection: Record<string, unknown> | null = null;
    if (inspRes?.ok) {
        const body = (await inspRes.json()) as { data?: Record<string, unknown> };
        const raw = body?.data ?? {};
        inspection = (raw.inspection as Record<string, unknown>) ?? raw;
    }

    const templates: Template[] = [];
    if (tplRes?.ok) {
        const body = (await tplRes.json()) as { data?: Template[] };
        for (const t of body?.data ?? []) {
            if (t?.id && t?.name) templates.push({ id: t.id, name: t.name });
        }
    }

    const members: Member[] = [];
    if (membersRes?.ok) {
        const body = (await membersRes.json()) as { data?: { members?: Member[] } };
        for (const m of body?.data?.members ?? []) {
            if (m?.id) members.push({ id: m.id, email: m.email ?? "", role: m.role ?? "" });
        }
    }

    return { inspection, templates, members };
}
