/**
 * #529 — the inspection settings read, as a server helper.
 *
 * Bundles GET /api/inspections/:id + /api/inspections/templates +
 * /api/inspections/:id/media into one server call so the caller has the
 * inspection row, the template list and the cover-picker photos. Two callers:
 * the BFF resource route `/resources/inspection-settings-sheet` (the only
 * reader the editor's field data source had) and the hub loader, so the hub's
 * Settings card renders from loader data instead of a client fetch on mount —
 * a browser fetch from the hub would break the hub's hermetic web-unit tests
 * and flash a skeleton on every visit.
 *
 * Never throws: every read carries its own fallback, and a missing id answers
 * the empty shape. The appearance profiles are the host's own static list.
 */
import { flattenMedia } from "@core/field-ui/shared/inspection-media";
import type { SettingsSheetData } from "@core/field-ui/data-source-types";
import type { Api } from "~/lib/api-client.server";
import { CLIENT_PROFILE_LIST } from "~/lib/report-style/profiles-client";

interface Template {
    id: string;
    name: string;
}

// DB-16 — a flat photo the inspector can pick as the report cover.
interface CoverPhoto {
    key: string;
    url: string;
    label: string;
}

const EMPTY: SettingsSheetData = {
    inspection: null,
    templates: [],
    photos: [],
    profiles: CLIENT_PROFILE_LIST.map((p) => ({ id: p.id, name: p.name })),
};

export async function loadInspectionSettings(api: Api, inspectionId: string): Promise<SettingsSheetData> {
    if (!inspectionId) return EMPTY;

    // Optional-chained like the hub loader's own reads: a narrower mocked
    // api-client in unit tests degrades cleanly instead of throwing on a
    // missing property (the hub's SMS-consent tests mock only the endpoints
    // they exercise).
    const inspGet = api.inspections?.[":id"]?.$get as unknown as ((args: { param: { id: string } }) => Promise<Response>) | undefined;
    const tplGet = api.inspections?.templates?.$get as unknown as ((args: { query: { page: string; pageSize: string } }) => Promise<Response>) | undefined;
    const mediaGet = api.inspections?.[":id"]?.media?.$get as unknown as ((args: { param: { id: string } }) => Promise<Response>) | undefined;

    const [inspRes, tplRes, mediaRes] = await Promise.all([
        inspGet ? inspGet({ param: { id: inspectionId } }).catch(() => null) : null,
        tplGet ? tplGet({ query: { page: "1", pageSize: "100" } }).catch(() => null) : null,
        mediaGet ? mediaGet({ param: { id: inspectionId } }).catch(() => null) : null,
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

    // DB-16 — flatten attached + pool photos into one pickable cover list.
    // Dedup by R2 key (shared flattenMedia helper): results.data can store an
    // item under BOTH a composite (unit::section::item) and a bare itemId key,
    // which makes the media center surface the same photo twice; the cover grid
    // must show each photo once.
    // Request small thumbnails (?w=240) for the grid so the browser doesn't pull
    // full-resolution originals; the photo endpoint resizes when CF Images is
    // available and falls back to the original otherwise.
    const thumb = (url: string) => (url.includes("?") ? `${url}&w=240` : `${url}?w=240`);
    const mediaBody = mediaRes?.ok ? ((await mediaRes.json()) as Parameters<typeof flattenMedia>[0]) : null;
    const photos: CoverPhoto[] = flattenMedia(mediaBody).map((p) => ({ key: p.key, url: thumb(p.url), label: p.label }));

    return { inspection, templates, photos, profiles: EMPTY.profiles };
}
