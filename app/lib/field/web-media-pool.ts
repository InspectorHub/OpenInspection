/**
 * The web host's `resources.mediaPool`: the inspection's photos for the gallery over the BFF resource route
 * `/resources/inspection-media`. Never throws: a failed, unauthenticated or malformed read answers
 * `answered: false` (the route's own way of saying "no answer came back", as opposed to "no photos").
 */
import type { FieldResources } from "@core/field-ui/data-source";
import type { MediaPoolListing } from "@core/field-ui/data-source-types";

const MEDIA_POOL_ROUTE = "/resources/inspection-media";

type MediaPool = NonNullable<FieldResources["mediaPool"]>;

const UNANSWERED: MediaPoolListing = { photos: [], answered: false };

export function createWebMediaPool(fetchImpl: typeof fetch = (input, init) => fetch(input, init)): MediaPool {
    return {
        async list(inspectionId: string): Promise<MediaPoolListing> {
            try {
                const res = await fetchImpl(`${MEDIA_POOL_ROUTE}?inspectionId=${encodeURIComponent(inspectionId)}`, {
                    credentials: "include",
                    headers: { accept: "application/json" },
                });
                if (!res.ok || res.redirected) return UNANSWERED;
                if (!res.headers.get("content-type")?.toLowerCase().includes("json")) return UNANSWERED;
                const body = (await res.json().catch(() => null)) as Partial<MediaPoolListing> | null;
                if (body === null || typeof body !== "object" || !Array.isArray(body.photos)) return UNANSWERED;
                return { photos: body.photos, answered: body.answered === true };
            } catch {
                return UNANSWERED;
            }
        },
    };
}
