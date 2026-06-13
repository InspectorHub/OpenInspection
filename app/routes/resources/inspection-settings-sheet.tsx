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
    // Dedup by R2 key: results.data can store an item under BOTH a composite
    // (unit::section::item) and a bare itemId key, which makes the media center
    // surface the same photo twice; the cover grid must show each photo once.
    const photos: CoverPhoto[] = [];
    const seen = new Set<string>();
    // Request small thumbnails (?w=240) for the grid so the browser doesn't pull
    // full-resolution originals; the photo endpoint resizes when CF Images is
    // available and falls back to the original otherwise.
    const thumb = (url: string) => (url.includes("?") ? `${url}&w=240` : `${url}?w=240`);
    const pushPhoto = (key?: string, url?: string, label = "") => {
        if (!key || !url || seen.has(key)) return;
        seen.add(key);
        photos.push({ key, url: thumb(url), label });
    };
    if (mediaRes?.ok) {
        const body = (await mediaRes.json()) as {
            data?: {
                attached?: Array<{ key: string; url: string; itemLabel?: string }>;
                pool?: Array<{ key: string; url: string }>;
            };
        };
        for (const a of body?.data?.attached ?? []) pushPhoto(a?.key, a?.url, a?.itemLabel ?? "");
        for (const p of body?.data?.pool ?? []) pushPhoto(p?.key, p?.url, "Unattached");
    }

    return { inspection, templates, members, photos };
}

// The sheet loads this data once when it opens (explicit fetcher.load) and then
// manages cover/save state locally. Without this guard, React Router revalidates
// the fetcher.load after every editor mutation (save-settings, set-cover,
// upload-cover), which reloads the sheet into its loading state and flickers the
// whole panel. Explicit .load() on open still runs — shouldRevalidate only gates
// automatic revalidation.
export function shouldRevalidate() {
    return false;
}
