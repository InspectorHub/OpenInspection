/**
 * The web host's `resources.video`: the capture flow's four requests plus the poster picker's one, over the
 * engine's video endpoints (`/api/inspections/:id/media/video/*`, JWT-cookie authed, so called directly).
 *
 * The requests are the ones the capture sheet built itself: create-upload (JSON), the clip POSTed to the
 * returned `uploadURL` with XHR progress (r2: the worker route answers the real `{ mediaId, r2Key }`; stream:
 * straight to Cloudflare, no body), r2-upload-poster (multipart, the upload token read off the `uploadURL`),
 * and finalize (JSON). `remove` has no web path yet and answers a plain "not wired" failure rather than doing
 * nothing silently.
 *
 * Nothing here throws: a failed, redirected or unreachable call answers `{ ok: false, error }`. `error` is the
 * API's own reason when it sent one, else a status-coded sentence, else the capture's generic upload failure.
 */
import type { CommandResult } from "@core/field-ui/commands";
import type { FieldResources } from "@core/field-ui/data-source";
import type { VideoFinalizeInput, VideoUploadTicket } from "@core/field-ui/data-source-types";
import { m } from "~/paraglide/messages";

type VideoStore = NonNullable<FieldResources["video"]>;

const base = (inspectionId: string) => `/api/inspections/${inspectionId}/media/video`;

export const posterRoute = (inspectionId: string) => `${base(inspectionId)}/poster`;

const notWired = (what: string) => `${what} is not wired to the web data source yet; the editor still uses its own path for it.`;

/**
 * The r2 ticket's upload URL is minted against the deployment's configured public origin, which is not
 * necessarily the origin the browser is on (a dev tunnel, a custom domain): sent as-is, the cross-origin
 * request is blocked. A worker route (`/api/...`) is always reachable on the current origin, so it is sent as
 * a relative path. Anything else (the Stream provider's external direct-upload URL) is left untouched.
 */
export function sameOriginUploadUrl(uploadURL: string): string {
    try {
        const url = new URL(uploadURL, "http://host.invalid");
        return url.pathname.startsWith("/api/") ? `${url.pathname}${url.search}` : uploadURL;
    } catch {
        return uploadURL;
    }
}

const networkError = (err: unknown) => (err instanceof Error && err.message ? err.message : "Network error");

/**
 * Pull the human-readable reason out of the API's `{ error: { message } }` envelope so the editor can show WHY
 * an upload failed (e.g. the video service is out of quota) instead of a blanket "check your connection".
 * Falls back to a status-coded message when the body has no usable reason.
 */
export async function apiErrorReason(res: Response): Promise<string> {
    try {
        const body = (await res.json()) as { error?: { message?: string } };
        if (body?.error?.message) return body.error.message;
    } catch {
        // non-JSON / body already consumed: fall through to the generic message
    }
    return m.media_video_err_upload_status({ status: res.status });
}

/** POST a file with an upload progress callback; resolves with the response text on 2xx. */
export function uploadWithProgressBody(url: string, file: Blob, onProgress: (pct: number) => void, withCredentials: boolean): Promise<string> {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", url);
        if (withCredentials) xhr.withCredentials = true;
        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) onProgress((e.loaded / e.total) * 100);
        };
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve(xhr.responseText) : reject(new Error(`upload ${xhr.status}`)));
        xhr.onerror = () => reject(new Error("upload network error"));
        const fd = new FormData();
        fd.append("file", file);
        xhr.send(fd);
    });
}

export function createWebVideo(fetchImpl: typeof fetch = (input, init) => fetch(input, init)): VideoStore {
    return {
        async createUpload(inspectionId, input): Promise<CommandResult<VideoUploadTicket>> {
            try {
                // busy-controls-allow: the caller (VideoCapture) takes its same-frame latch before it calls; each create-upload mints a pool row and an upload URL
                const res = await fetchImpl(`${base(inspectionId)}/create-upload`, {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(input.itemId ? { itemId: input.itemId } : {}),
                });
                if (!res.ok) return { ok: false, error: await apiErrorReason(res) };
                const { data } = (await res.json()) as { data?: VideoUploadTicket };
                if (!data?.uploadURL || !data?.ref) return { ok: false, error: m.media_video_err_unexpected() };
                return { ok: true, data };
            } catch {
                return { ok: false, error: m.media_video_err_upload() };
            }
        },
        async uploadFile(ticket, file, onProgress): Promise<CommandResult<{ mediaId: string; r2Key: string } | undefined>> {
            try {
                if (ticket.ref.provider !== "r2") {
                    // Stream: the bytes go straight to Cloudflare, never through this worker (no GPS-leak path).
                    await uploadWithProgressBody(ticket.uploadURL, file, onProgress, false);
                    return { ok: true };
                }
                const text = await uploadWithProgressBody(sameOriginUploadUrl(ticket.uploadURL), file, onProgress, true);
                let r2: { mediaId?: string; r2Key?: string } | undefined;
                try {
                    r2 = (JSON.parse(text) as { data?: { mediaId?: string; r2Key?: string } }).data;
                } catch {
                    // fall through to the unexpected-response answer
                }
                if (!r2?.mediaId || !r2?.r2Key) return { ok: false, error: m.media_video_err_unexpected() };
                return { ok: true, data: { mediaId: r2.mediaId, r2Key: r2.r2Key } };
            } catch {
                return { ok: false, error: m.media_video_err_upload() };
            }
        },
        async uploadPoster(inspectionId, ticket, blob): Promise<CommandResult<{ posterKey: string }>> {
            try {
                // The upload token rides in the uploadURL's query string; the poster route reuses it.
                const token = new URL(ticket.uploadURL, "http://host.invalid").searchParams.get("token") ?? "";
                const fd = new FormData();
                fd.append("file", blob, "poster.jpg");
                // busy-controls-allow: runs inside the capture flow that VideoCapture's same-frame latch already admitted once; a repeat overwrites the same poster object
                const res = await fetchImpl(`${base(inspectionId)}/r2-upload-poster?token=${encodeURIComponent(token)}`, {
                    method: "POST",
                    credentials: "include",
                    body: fd,
                });
                if (!res.ok) return { ok: false };
                const body = (await res.json()) as { data?: { posterKey?: string } };
                return body.data?.posterKey ? { ok: true, data: { posterKey: body.data.posterKey } } : { ok: false };
            } catch {
                return { ok: false };
            }
        },
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
                return { ok: false, error: networkError(err) };
            }
        },
        async finalize(inspectionId, input: VideoFinalizeInput): Promise<CommandResult<{ poolId: string }>> {
            try {
                // busy-controls-allow: runs inside the capture flow that VideoCapture's same-frame latch already admitted once; one finalize per accepted pick
                const res = await fetchImpl(`${base(inspectionId)}/finalize`, {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(input),
                });
                if (!res.ok) return { ok: false, error: await apiErrorReason(res) };
                const body = (await res.json()) as { data?: { poolId?: string } };
                return { ok: true, data: { poolId: body.data?.poolId ?? "" } };
            } catch {
                return { ok: false, error: m.media_video_err_upload() };
            }
        },
        remove: async () => ({ ok: false, error: notWired("Video removal") }),
    };
}
