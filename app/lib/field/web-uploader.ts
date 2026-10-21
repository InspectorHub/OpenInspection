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
import type { PendingMediaRecord } from "@core/field-ui/media-types";
import { readResultMap } from "@core/field-ui/collab/results-binding";
import type { PhotoEntry } from "@core/field-ui/shared/results-doc.types";

/** The BFF route every upload goes to. */
export const MEDIA_UPLOAD_ENDPOINT = "/resources/media-upload";

/** Resolve the CURRENT index of `photoKey` in the doc's photo array for `findingKey`. */
function currentPhotoIndex(doc: Y.Doc, findingKey: string, photoKey: string): number {
    const entry = readResultMap(doc)[findingKey];
    const photos = (entry?.photos as PhotoEntry[] | undefined) ?? [];
    return photos.findIndex((p) => p.key === photoKey);
}

async function post(fd: FormData): Promise<{ ok: boolean; status: number; body: { data?: Record<string, string | undefined> } | null }> {
    const res = await fetch(MEDIA_UPLOAD_ENDPOINT, { method: "POST", credentials: "include", body: fd });
    const body = res.ok
        ? ((await res.json().catch(() => null)) as { data?: Record<string, string | undefined> } | null)
        : null;
    return { ok: res.ok, status: res.status, body };
}

export function createWebUploader(inspectionId: string, doc: Y.Doc): MediaUploader {
    return {
        async upload(rec: PendingMediaRecord): Promise<UploadResult> {
            const fd = new FormData();
            fd.append("kind", rec.kind);
            fd.append("inspectionId", inspectionId);
            fd.append("itemId", rec.meta.itemId);

            if (rec.kind === "photo") {
                fd.append("file", new File([rec.blob], "photo.jpg", { type: rec.blob.type || "image/jpeg" }));
                const res = await post(fd);
                if (!res.ok) throw new Error(`upload failed: ${res.status}`);
                const key = res.body?.data?.key;
                if (!key) throw new Error("upload returned no key");
                return { key };
            }

            // crop / annotate: resolve the CURRENT photo index by base key.
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
