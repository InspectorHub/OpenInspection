/**
 * C-12 — BFF resource route for InspectionSettingsSheet component.
 *
 * loader: the settings read (`loadInspectionSettings` — inspection row,
 * template list, cover-picker photos) plus the team members, in one server
 * call so the component has no raw client-side fetches.
 */
import type { Route } from "./+types/inspection-settings-sheet";
import { getToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { loadInspectionSettings } from "~/lib/inspection-settings-loader.server";

interface Member {
    id: string;
    email: string;
    role: string;
}

const EMPTY = { inspection: null, templates: [] as { id: string; name: string }[], members: [] as Member[], photos: [] as { key: string; url: string; label: string }[] };

export async function loader({ request, context }: Route.LoaderArgs) {
    const token = await getToken(context, request);
    if (!token) return EMPTY;

    const url = new URL(request.url);
    const inspectionId = url.searchParams.get("inspectionId") ?? "";
    if (!inspectionId) return EMPTY;

    const api = createApi(context, { token });

    const [sheet, membersRes] = await Promise.all([
        loadInspectionSettings(api, inspectionId),
        api.team.members.$get({}).catch(() => null),
    ]);

    const members: Member[] = [];
    if (membersRes?.ok) {
        const body = (await membersRes.json()) as { data?: { members?: Member[] } };
        for (const m of body?.data?.members ?? []) {
            if (m?.id) members.push({ id: m.id, email: m.email ?? "", role: m.role ?? "" });
        }
    }

    return { ...sheet, members };
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
