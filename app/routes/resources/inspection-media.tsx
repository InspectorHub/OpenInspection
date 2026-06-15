/**
 * Image Studio — BFF resource route for the unified photo gallery.
 *
 * loader: bundles GET /api/inspections/:id/media into a deduped, labeled photo
 *         list (flattenMedia) so the gallery component has no raw client-side
 *         fetches. Mirrors inspection-settings-sheet's token/createApi pattern.
 */
import type { Route } from "./+types/inspection-media";
import { getToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { flattenMedia, type GalleryPhoto } from "~/lib/inspection-media";

export async function loader({ request, context }: Route.LoaderArgs): Promise<{ photos: GalleryPhoto[] }> {
    const token = await getToken(context, request);
    if (!token) return { photos: [] };
    const inspectionId = new URL(request.url).searchParams.get("inspectionId") ?? "";
    if (!inspectionId) return { photos: [] };
    const api = createApi(context, { token });
    const hdr = { headers: { "x-token-relay": "1" } } as const;
    const res = await api.inspections[":id"].media.$get({ param: { id: inspectionId } }, hdr).catch(() => null);
    const body = res?.ok ? ((await res.json()) as Parameters<typeof flattenMedia>[0]) : null;
    // Gallery thumbnails request a larger width (?w=480) than the cover grid
    // (?w=240) since the lightbox shows photos at a meaningful size.
    const thumb = (url: string) => (url.includes("?") ? `${url}&w=480` : `${url}?w=480`);
    return { photos: flattenMedia(body).map((p) => ({ ...p, url: thumb(p.url) })) };
}

// The gallery loads this once when it opens; gate automatic revalidation the
// same way the settings sheet does to avoid flicker on editor mutations.
export function shouldRevalidate() {
    return false;
}
