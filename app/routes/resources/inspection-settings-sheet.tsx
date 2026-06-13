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

// DB-16 — a flat photo the inspector can pick as the report cover.
interface CoverPhoto {
    key: string;
    url: string;
    label: string;
}

const EMPTY = { inspection: null, templates: [] as Template[], members: [] as Member[], photos: [] as CoverPhoto[] };

export async function loader({ request, context }: Route.LoaderArgs) {
    const token = await getToken(context, request);
    if (!token) return EMPTY;

    const url = new URL(request.url);
    const inspectionId = url.searchParams.get("inspectionId") ?? "";
    if (!inspectionId) return EMPTY;

    const api = createApi(context, { token });
    const hdr = { headers: { "x-token-relay": "1" } } as const;

    const [inspRes, tplRes, membersRes, mediaRes] = await Promise.all([
        api.inspections[":id"].$get({ param: { id: inspectionId } }, hdr).catch(() => null),
        api.inspections.templates.$get({ query: { page: "1", pageSize: "100" } }, hdr).catch(() => null),
        api.team.members.$get({}, hdr).catch(() => null),
        api.inspections[":id"].media.$get({ param: { id: inspectionId } }, hdr).catch(() => null),
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

    // DB-16 — flatten attached + pool photos into one pickable cover list.
    const photos: CoverPhoto[] = [];
    if (mediaRes?.ok) {
        const body = (await mediaRes.json()) as {
            data?: {
                attached?: Array<{ key: string; url: string; itemLabel?: string }>;
                pool?: Array<{ key: string; url: string }>;
            };
        };
        for (const a of body?.data?.attached ?? []) {
            if (a?.key && a?.url) photos.push({ key: a.key, url: a.url, label: a.itemLabel ?? "" });
        }
        for (const p of body?.data?.pool ?? []) {
            if (p?.key && p?.url) photos.push({ key: p.key, url: p.url, label: "Unattached" });
        }
    }

    return { inspection, templates, members, photos };
}
