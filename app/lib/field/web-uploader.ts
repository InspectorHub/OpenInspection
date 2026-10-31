/**
 * Web uploader for the offline media drain.
 *
 * Every upload is a same-origin POST to the BFF resource route
 * (`app/routes/resources/media-upload.ts`), which holds the session and forwards
 * to the API. It never calls `/api/inspections/...` from the browser: that call
 * carries no session in hosted deployments.
 *
 * The crop and annotation endpoints address a photo by index, and indices shift
 * as photos are added or removed. The photo KEY is the authority, so the current
 * index is resolved from the live results document here, at upload time, never
 * at enqueue time. If the base photo has been deleted the upload throws and the
 * record stays queued: there is nothing left to derive from.
 *
 * The server skips the legacy results write under collab, so the doc swap the
 * drain performs afterwards is the only write of the derivative.
 */
import type * as Y from "yjs";
import type { MediaUploader, UploadResult } from "@core/field-ui/collab/media-upload-queue";
import type { MediaUploader as FieldMediaUploader, PendingMediaRecord } from "@core/field-ui/media-types";
import { readResultMap } from "@core/field-ui/collab/results-binding";
import type { PhotoEntry } from "@core/field-ui/shared/results-doc.types";

/** The BFF route every upload goes to. */
const MEDIA_UPLOAD_ENDPOINT = "/resources/media-upload";

/** Resolve the CURRENT index of `photoKey` in the doc's photo array for `findingKey`. */
function currentPhotoIndex(doc: Y.Doc, findingKey: string, photoKey: string): number {
    const entry = readResultMap(doc)[findingKey];
    const photos = (entry?.photos as PhotoEntry[] | undefined) ?? [];
    return photos.findIndex((p) => p.key === photoKey);
}

/**
 * Longest an upload may take before it is abandoned and treated as failed (the queue keeps the record and retries; an online
 * crop answers a failure). A photo over a slow mobile link is legitimately slow, so this is generous, but it must exist: a request that
 * never settles would hold a same-frame guard (or a drain) forever.
 */
const UPLOAD_TIMEOUT_MS = 180_000;

function uploadSignal(): AbortSignal | undefined {
    if (typeof AbortSignal === "undefined") return undefined;
    if (typeof AbortSignal.timeout === "function") return AbortSignal.timeout(UPLOAD_TIMEOUT_MS);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
    return controller.signal;
}

interface MediaAnswer {
    ok: boolean;
    status: number;
    body: { data?: Record<string, string | undefined> } | null;
    /** The stable error code the route relays from the API; undefined on success or when there is none. */
    code: string | undefined;
}

async function post(fd: FormData): Promise<MediaAnswer> {
    const signal = uploadSignal();
    const res = await fetch(MEDIA_UPLOAD_ENDPOINT, { method: "POST", credentials: "include", body: fd, ...(signal ? { signal } : {}) });
    if (res.ok) {
        return { ok: true, status: res.status, body: (await res.json().catch(() => null)) as { data?: Record<string, string | undefined> } | null, code: undefined };
    }
    const failure = (await res.json().catch(() => null)) as { code?: unknown } | null;
    return { ok: false, status: res.status, body: null, code: typeof failure?.code === "string" ? failure.code : undefined };
}

/** The server refused these very bytes with a stable code (see below): retrying cannot succeed. Every other failure is a plain Error. */
class UploadRefused extends Error {
    constructor(message: string) {
        super(message);
        this.name = "UploadRefused";
    }
}

/**
 * Stable reason codes for a refused photo. Deleting a queued photo is irreversible, so a refusal is permanent ONLY when
 * the server says so with a stable code the media route relays from the API, never by status alone and never by message
 * text: `PHOTO_TOO_LARGE` (with 413) and `UNSUPPORTED_PHOTO_TYPE` (with 400). A bare 413 can come from a proxy or edge
 * limit in front of the server, and a bare 400 also carries 'Storage not available' and 'itemId is required'; both, like
 * 415, 422, 401/403, 429 and 5xx, stay generic: the photo stays queued and is retried.
 */
const TOO_LARGE = "TOO_LARGE";
const UNSUPPORTED_TYPE = "UNSUPPORTED_TYPE";
const API_PHOTO_TOO_LARGE = "PHOTO_TOO_LARGE";
const API_UNSUPPORTED_PHOTO_TYPE = "UNSUPPORTED_PHOTO_TYPE";

/** `doc` is null when the host has no results document yet; a crop or annotation then fails, a photo does not need one. */
export function createWebUploader(inspectionId: string, doc: Y.Doc | null): MediaUploader {
    return {
        async upload(rec: PendingMediaRecord): Promise<UploadResult> {
            const fd = new FormData();
            fd.append("kind", rec.kind);
            fd.append("inspectionId", inspectionId);
            fd.append("itemId", rec.meta.itemId);

            if (rec.kind === "photo") {
                fd.append("file", new File([rec.blob], "photo.jpg", { type: rec.blob.type || "image/jpeg" }));
                const res = await post(fd);
                if (res.status === 413 && res.code === API_PHOTO_TOO_LARGE) throw new UploadRefused(TOO_LARGE);
                if (res.status === 400 && res.code === API_UNSUPPORTED_PHOTO_TYPE) throw new UploadRefused(UNSUPPORTED_TYPE);
                if (!res.ok) throw new Error(`upload failed: ${res.status}`);
                const key = res.body?.data?.key;
                if (!key) throw new Error("upload returned no key");
                return { key };
            }

            // crop / annotate: resolve the CURRENT photo index by base key.
            if (!doc) throw new Error("no results document to resolve the photo in");
            const index = currentPhotoIndex(doc, rec.meta.findingKey, rec.meta.photoKey);
            if (index < 0) throw new Error("base photo no longer present");
            fd.append("photoIndex", String(index));
            if (rec.meta.sectionId) fd.append("sectionId", rec.meta.sectionId);

            if (rec.kind === "crop") {
                fd.append("image", new File([rec.blob], "cropped.jpg", { type: "image/jpeg" }));
                fd.append("crop", JSON.stringify(rec.meta.crop));
                const res = await post(fd);
                if (!res.ok) throw new Error(`crop failed: ${res.status}`);
                const croppedKey = res.body?.data?.croppedKey;
                if (!croppedKey) throw new Error("crop returned no croppedKey");
                return { croppedKey };
            }

            fd.append("image", new File([rec.blob], "annotated.png", { type: "image/png" }));
            fd.append("nodes", rec.meta.nodesJson);
            const res = await post(fd);
            if (!res.ok) throw new Error(`annotation failed: ${res.status}`);
            const annotatedKey = res.body?.data?.annotatedKey;
            if (!annotatedKey) throw new Error("annotation returned no annotatedKey");
            return { annotatedKey };
        },
    };
}

/**
 * The `FieldDataSource.media.uploader` for the web: the same upload, answered the way the
 * package contract asks (`{ ok, key }`, never a throw). The key is the stored photo key, the
 * `croppedKey` or the `annotatedKey`, by the record's kind.
 */
export function createWebMediaUploader(inspectionId: string, doc: Y.Doc | null): FieldMediaUploader {
    const inner = createWebUploader(inspectionId, doc);
    return {
        async upload(rec: PendingMediaRecord) {
            try {
                const result = await inner.upload(rec);
                const key = rec.kind === "photo" ? result.key : rec.kind === "crop" ? result.croppedKey : result.annotatedKey;
                return key ? { ok: true as const, key } : { ok: false as const, error: "upload returned no key" };
            } catch (err) {
                const error = err instanceof Error && err.message ? err.message : "upload failed";
                return err instanceof UploadRefused && rec.kind === "photo"
                    ? { ok: false as const, error, permanent: true as const }
                    : { ok: false as const, error };
            }
        },
    };
}
