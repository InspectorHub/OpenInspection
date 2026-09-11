/**
 * Media Studio — BFF resource route for the unified photo gallery.
 *
 * loader: bundles GET /api/inspections/:id/media into a deduped, labeled photo
 *         list (flattenMedia) so the gallery component has no raw client-side
 *         fetches. Mirrors inspection-settings-sheet's token/createApi pattern.
 */
import type { Route } from "./+types/inspection-media";
import { getToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { flattenMedia, type GalleryPhoto } from "~/lib/inspection-media";

/**
 * `answered` is the difference between "this inspection has no photos" and "no
 * answer came back" (F57).
 *
 * Every failure on this route used to leave by the same door as an empty
 * inspection — a missing token, a missing id, a rejected fetch and a non-OK
 * status all returned `{ photos: [] }` — and the gallery turned that into "No
 * photos in this inspection yet.", which is a claim about the inspection that
 * nothing here is in a position to make. The caller needs to be able to tell a
 * fact from a silence, so it can offer a retry instead of asserting.
 */
export async function loader({ request, context }: Route.LoaderArgs): Promise<{ photos: GalleryPhoto[]; answered: boolean }> {
    const token = await getToken(context, request);
    if (!token) return { photos: [], answered: false };
    const inspectionId = new URL(request.url).searchParams.get("inspectionId") ?? "";
    if (!inspectionId) return { photos: [], answered: false };
    const api = createApi(context, { token });
    const hdr = { headers: { "x-token-relay": "1" } } as const;
    const res = await api.inspections[":id"].media.$get({ param: { id: inspectionId } }, hdr).catch(() => null);
    if (!res?.ok) return { photos: [], answered: false };
    const body = (await res.json()) as Parameters<typeof flattenMedia>[0];
    // Gallery thumbnails request a larger width (?w=480) than the cover grid
    // (?w=240) since the lightbox shows photos at a meaningful size.
    const thumb = (url: string) => (url.includes("?") ? `${url}&w=480` : `${url}?w=480`);
    return { photos: flattenMedia(body).map((p) => ({ ...p, url: thumb(p.url) })), answered: true };
}

// The gallery loads this once when it opens; gate automatic revalidation the
// same way the settings sheet does to avoid flicker on editor mutations.
export function shouldRevalidate() {
    return false;
}
