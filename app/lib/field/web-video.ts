/**
 * The web host's `resources.video`. Only `setPoster` is wired: it posts the same JSON body to the same
 * endpoint the poster picker's fetcher did. The other members belong to the capture flow, which still
 * runs its own requests; they answer a plain "not wired" failure rather than doing nothing silently.
 *
 * Nothing here throws: a failed, redirected or unreachable call answers `{ ok: false, error }`.
 */
import type { CommandResult } from "@core/field-ui/commands";
import type { FieldResources } from "@core/field-ui/data-source";

type VideoStore = NonNullable<FieldResources["video"]>;

export const posterRoute = (inspectionId: string) => `/api/inspections/${inspectionId}/media/video/poster`;

const notWired = (what: string) => `${what} is not wired to the web data source yet; the editor still uses its own path for it.`;

export function createWebVideo(fetchImpl: typeof fetch = (input, init) => fetch(input, init)): VideoStore {
    return {
        createUpload: () => Promise.reject(new Error(notWired("Video upload"))),
        uploadPoster: async () => ({ ok: false, error: notWired("Poster upload") }),
        async setPoster(inspectionId, input): Promise<CommandResult> {
            try {
                // busy-controls-allow: the caller (PosterPicker) latches the press; the endpoint writes the posted absolute posterPct onto the Stream video and the pool row, so a repeat rewrites the same value
                const res = await fetchImpl(posterRoute(inspectionId), {
                    method: "POST",
                    credentials: "include",
                    headers: { "content-type": "application/json", accept: "application/json" },
                    body: JSON.stringify({ streamUid: input.streamUid, posterPct: input.posterPct }),
                });
                if (res.redirected) return { ok: false, error: "Session expired" };
                if (!res.ok) return { ok: false, error: "The poster frame was not saved." };
                return { ok: true };
            } catch (err) {
                return { ok: false, error: err instanceof Error && err.message ? err.message : "Network error" };
            }
        },
        finalize: async () => ({ ok: false, error: notWired("Video finalize") }),
        remove: async () => ({ ok: false, error: notWired("Video removal") }),
    };
}
