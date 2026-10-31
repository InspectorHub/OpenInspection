// @vitest-environment happy-dom
/**
 * The web uploader behind the offline media drain.
 *
 * Every upload goes to the same-origin BFF resource route, never to
 * `/api/inspections/...`: the browser-direct call was the pattern the BFF
 * exists to replace, and it answers 401 in hosted deployments.
 *
 * The photo index of a crop / annotation is resolved from the LIVE results
 * document at upload time (the photo key is the authority, the queued index is a
 * stale snapshot).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as Y from "yjs";
import { seedResultsDoc, appendPhoto } from "@core/field-ui/shared/results-doc";
import type { PendingMediaRecord } from "@core/field-ui/media-types";
import { onlinePhotoRejectionMessages } from "@core/field-ui/editor/photo-rejection-messages";
import { m } from "@core/field-ui/i18n";
import type { MediaFileResult } from "@core/field-ui/media-types";
import { createWebMediaUploader, createWebUploader } from "./web-uploader";

const FK = "_default:s1:i1";
const ENDPOINT = "/resources/media-upload";

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function docWithPhotos(...keys: string[]): Y.Doc {
    const doc = new Y.Doc();
    seedResultsDoc(doc, [{ findingKey: FK }]);
    for (const key of keys) appendPhoto(doc, FK, { key, mediaType: "photo" });
    return doc;
}

const crop = { aspect: "3:2", orientation: "landscape" as const, x: 1, y: 2, width: 30, height: 20 };

function photoRec(): PendingMediaRecord {
    return {
        kind: "photo", pendingId: "p1", inspectionId: "insp-1", createdAt: 1,
        blob: new Blob(["bytes"], { type: "image/jpeg" }),
        meta: { targetType: "item", findingKey: FK, itemId: "i1" },
    };
}
function cropRec(photoKey = "r2/base.jpg", withSection = true): PendingMediaRecord {
    return {
        kind: "crop", pendingId: "p2", inspectionId: "insp-1", createdAt: 2,
        blob: new Blob(["c"], { type: "image/jpeg" }),
        meta: { findingKey: FK, itemId: "i1", photoIndex: 0, photoKey, crop, ...(withSection ? { sectionId: "s1" } : {}) },
    };
}
function annotRec(photoKey = "r2/base.jpg"): PendingMediaRecord {
    return {
        kind: "annotate", pendingId: "p3", inspectionId: "insp-1", createdAt: 3,
        blob: new Blob(["a"], { type: "image/png" }),
        meta: { findingKey: FK, itemId: "i1", photoIndex: 0, photoKey, nodesJson: '[{"t":"rect"}]', sectionId: "s1" },
    };
}

function lastCall(): { url: string; init: RequestInit; form: FormData } {
    const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [string, RequestInit];
    return { url, init, form: init.body as FormData };
}

beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
    vi.unstubAllGlobals();
});

describe("web uploader: same-origin BFF only", () => {
    it("photo goes to the BFF route with kind + inspection + item and returns {key}", async () => {
        fetchMock.mockResolvedValue(jsonResponse({ data: { key: "r2/new.jpg" } }));
        const out = await createWebUploader("insp-1", docWithPhotos()).upload(photoRec());
        expect(out).toEqual({ key: "r2/new.jpg" });
        const { url, init, form } = lastCall();
        expect(url).toBe(ENDPOINT);
        expect(init.method).toBe("POST");
        expect(form.get("kind")).toBe("photo");
        expect(form.get("inspectionId")).toBe("insp-1");
        expect(form.get("itemId")).toBe("i1");
        expect(form.get("file")).toBeInstanceOf(File);
    });

    it("crop resolves the photo index from the LIVE doc at drain time", async () => {
        fetchMock.mockResolvedValue(jsonResponse({ data: { croppedKey: "r2/c.jpg" } }));
        // The queued snapshot says index 0, but the photo has since moved to index 2.
        const doc = docWithPhotos("r2/other-a.jpg", "r2/other-b.jpg", "r2/base.jpg");
        const out = await createWebUploader("insp-1", doc).upload(cropRec());
        expect(out).toEqual({ croppedKey: "r2/c.jpg" });
        const { url, form } = lastCall();
        expect(url).toBe(ENDPOINT);
        expect(form.get("kind")).toBe("crop");
        expect(form.get("inspectionId")).toBe("insp-1");
        expect(form.get("itemId")).toBe("i1");
        expect(form.get("photoIndex")).toBe("2");
        expect(form.get("sectionId")).toBe("s1");
        expect(form.get("crop")).toBe(JSON.stringify(crop));
        expect(form.get("image")).toBeInstanceOf(File);
    });

    it("annotation resolves the index live and sends the node tree", async () => {
        fetchMock.mockResolvedValue(jsonResponse({ data: { annotatedKey: "r2/a.png" } }));
        const doc = docWithPhotos("r2/x.jpg", "r2/base.jpg");
        const out = await createWebUploader("insp-1", doc).upload(annotRec());
        expect(out).toEqual({ annotatedKey: "r2/a.png" });
        const { url, form } = lastCall();
        expect(url).toBe(ENDPOINT);
        expect(form.get("kind")).toBe("annotate");
        expect(form.get("photoIndex")).toBe("1");
        expect(form.get("nodes")).toBe('[{"t":"rect"}]');
        expect(form.get("sectionId")).toBe("s1");
    });

    it("never targets /api/inspections for any kind", async () => {
        fetchMock.mockImplementation(async () => jsonResponse({ data: { key: "k", croppedKey: "c", annotatedKey: "a" } }));
        const doc = docWithPhotos("r2/base.jpg");
        const up = createWebUploader("insp-1", doc);
        await up.upload(photoRec());
        await up.upload(cropRec());
        await up.upload(annotRec());
        expect(fetchMock).toHaveBeenCalledTimes(3);
        for (const [url] of fetchMock.mock.calls as [string][]) {
            expect(url).not.toContain("/api/");
            expect(url).toBe(ENDPOINT);
        }
    });

    it("omits sectionId when the record has none", async () => {
        fetchMock.mockResolvedValue(jsonResponse({ data: { croppedKey: "r2/c.jpg" } }));
        await createWebUploader("insp-1", docWithPhotos("r2/base.jpg")).upload(cropRec("r2/base.jpg", false));
        expect(lastCall().form.has("sectionId")).toBe(false);
    });
});

describe("web uploader: failures leave the record queued (throw)", () => {
    it("every upload request carries an abort signal, and a request that never settles is abandoned as a failure", async () => {
        // A fetch that honours the signal and otherwise never answers; the signal is shortened so the test does not wait minutes.
        const spy = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => AbortSignal.abort(new DOMException("The operation timed out.", "TimeoutError")));
        try {
            fetchMock.mockImplementation(
                (_url: string, init: RequestInit) =>
                    new Promise((_resolve, reject) => {
                        init.signal?.addEventListener("abort", () => reject(init.signal?.reason ?? new Error("aborted")));
                        if (init.signal?.aborted) reject(init.signal.reason ?? new Error("aborted"));
                    }),
            );
            await expect(createWebUploader("insp-1", docWithPhotos()).upload(photoRec())).rejects.toBeDefined();
            expect(spy).toHaveBeenCalledWith(180_000);
            expect(lastCall().init.signal).toBeDefined();
        } finally {
            spy.mockRestore();
        }
    });
    it("a non-OK photo answer throws", async () => {
        fetchMock.mockResolvedValue(jsonResponse({ error: "no" }, 500));
        await expect(createWebUploader("insp-1", docWithPhotos()).upload(photoRec())).rejects.toThrow("upload failed: 500");
    });
    it("a non-OK crop answer throws", async () => {
        fetchMock.mockResolvedValue(jsonResponse({}, 401));
        await expect(createWebUploader("insp-1", docWithPhotos("r2/base.jpg")).upload(cropRec())).rejects.toThrow("crop failed: 401");
    });
    it("a non-OK annotation answer throws", async () => {
        fetchMock.mockResolvedValue(jsonResponse({}, 404));
        await expect(createWebUploader("insp-1", docWithPhotos("r2/base.jpg")).upload(annotRec())).rejects.toThrow("annotation failed: 404");
    });
    it("a missing key throws, per kind", async () => {
        fetchMock.mockResolvedValue(jsonResponse({ data: {} }));
        const doc = docWithPhotos("r2/base.jpg");
        const up = createWebUploader("insp-1", doc);
        await expect(up.upload(photoRec())).rejects.toThrow("upload returned no key");
        await expect(up.upload(cropRec())).rejects.toThrow("crop returned no croppedKey");
        await expect(up.upload(annotRec())).rejects.toThrow("annotation returned no annotatedKey");
    });
    it("a base photo that is gone throws WITHOUT sending anything", async () => {
        const doc = docWithPhotos("r2/someone-else.jpg");
        const up = createWebUploader("insp-1", doc);
        await expect(up.upload(cropRec())).rejects.toThrow("base photo no longer present");
        await expect(up.upload(annotRec())).rejects.toThrow("base photo no longer present");
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe("createWebMediaUploader: the package contract (answers, never throws)", () => {
    it("answers { ok, key } with the key of the record's kind", async () => {
        fetchMock.mockImplementation(async () => jsonResponse({ data: { key: "k1", croppedKey: "c1", annotatedKey: "a1" } }));
        const up = createWebMediaUploader("insp-1", docWithPhotos("r2/base.jpg"));
        expect(await up.upload(photoRec())).toEqual({ ok: true, key: "k1" });
        expect(await up.upload(cropRec())).toEqual({ ok: true, key: "c1" });
        expect(await up.upload(annotRec())).toEqual({ ok: true, key: "a1" });
    });

    it("sends the same BFF request as the queue uploader", async () => {
        fetchMock.mockResolvedValue(jsonResponse({ data: { croppedKey: "r2/c.jpg" } }));
        const doc = docWithPhotos("r2/other.jpg", "r2/base.jpg");
        await createWebMediaUploader("insp-1", doc).upload(cropRec());
        const { url, form } = lastCall();
        expect(url).toBe(ENDPOINT);
        expect(form.get("photoIndex")).toBe("1");
        expect(form.get("kind")).toBe("crop");
    });

    it("answers { ok: false, error } instead of throwing: a refused request, a missing key, a vanished photo", async () => {
        const up = createWebMediaUploader("insp-1", docWithPhotos("r2/base.jpg"));
        fetchMock.mockResolvedValue(jsonResponse({ error: "no" }, 500));
        expect(await up.upload(photoRec())).toEqual({ ok: false, error: "upload failed: 500" });
        fetchMock.mockResolvedValue(jsonResponse({ data: {} }));
        expect(await up.upload(cropRec())).toEqual({ ok: false, error: "crop returned no croppedKey" });
        fetchMock.mockRejectedValue(new TypeError("offline"));
        expect(await up.upload(annotRec())).toEqual({ ok: false, error: "offline" });
        fetchMock.mockReset();
        const gone = createWebMediaUploader("insp-1", docWithPhotos("r2/someone-else.jpg"));
        expect(await gone.upload(cropRec())).toEqual({ ok: false, error: "base photo no longer present" });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("answers the stable TOO_LARGE code for a 413 carrying the server's PHOTO_TOO_LARGE code", async () => {
        const up = createWebMediaUploader("insp-1", docWithPhotos("r2/base.jpg"));
        fetchMock.mockResolvedValue(jsonResponse({ error: "Upstream answered 413", code: "PHOTO_TOO_LARGE" }, 413));
        expect(await up.upload(photoRec())).toEqual({ ok: false, error: "TOO_LARGE", permanent: true });
    });

    it("a plain 413 (a proxy or edge limit, no server code) is NOT permanent: the photo stays queued and is retried", async () => {
        const up = createWebMediaUploader("insp-1", docWithPhotos("r2/base.jpg"));
        for (const response of [jsonResponse({ error: "Upstream answered 413" }, 413), jsonResponse({ error: "x", code: "validation_error" }, 413), new Response("<html>too big</html>", { status: 413 })]) {
            fetchMock.mockResolvedValue(response);
            expect(await up.upload(photoRec())).toEqual({ ok: false, error: "upload failed: 413" });
        }
        // CONTROL: the same status WITH the server's code is the permanent refusal.
        fetchMock.mockResolvedValue(jsonResponse({ error: "Upstream answered 413", code: "PHOTO_TOO_LARGE" }, 413));
        expect(await up.upload(photoRec())).toEqual({ ok: false, error: "TOO_LARGE", permanent: true });
    });

    it("the size code on another status is not a size refusal", async () => {
        const up = createWebMediaUploader("insp-1", docWithPhotos("r2/base.jpg"));
        fetchMock.mockResolvedValue(jsonResponse({ error: "x", code: "PHOTO_TOO_LARGE" }, 500));
        expect(await up.upload(photoRec())).toEqual({ ok: false, error: "upload failed: 500" });
    });

    it("a 5xx or 429 is not permanent", async () => {
        const up = createWebMediaUploader("insp-1", docWithPhotos("r2/base.jpg"));
        for (const status of [429, 500, 502, 503, 401]) {
            fetchMock.mockResolvedValue(jsonResponse({ error: "no" }, status));
            expect(await up.upload(photoRec()), String(status)).toEqual({ ok: false, error: `upload failed: ${status}` });
        }
    });

    it("answers the stable UNSUPPORTED_TYPE code for the route's UNSUPPORTED_PHOTO_TYPE answer", async () => {
        const up = createWebMediaUploader("insp-1", docWithPhotos("r2/base.jpg"));
        fetchMock.mockResolvedValue(jsonResponse({ error: "Upstream answered 400", code: "UNSUPPORTED_PHOTO_TYPE" }, 400));
        expect(await up.upload(photoRec())).toEqual({ ok: false, error: "UNSUPPORTED_TYPE", permanent: true });
    });

    it("an unrecognised 400 is NOT a permanent rejection: the queued photo must be kept and retried", async () => {
        // The same status carries 'Storage not available' and 'itemId is required' as well as a refused file, and the first
        // is about the moment. Deleting a photo taken in the field for that would be silent data loss.
        const up = createWebMediaUploader("insp-1", docWithPhotos("r2/base.jpg"));
        for (const body of [{ error: "Upstream answered 400" }, { error: "Upstream answered 400", code: "validation_error" }]) {
            fetchMock.mockResolvedValue(jsonResponse(body, 400));
            expect(await up.upload(photoRec())).toEqual({ ok: false, error: "upload failed: 400" });
        }
        fetchMock.mockResolvedValue(new Response("<html>", { status: 400 }));
        expect(await up.upload(photoRec())).toEqual({ ok: false, error: "upload failed: 400" });
        // 422 judges the request, not the bytes, so it is not a reason to delete the photo either.
        fetchMock.mockResolvedValue(jsonResponse({ error: "no" }, 422));
        expect(await up.upload(photoRec())).toEqual({ ok: false, error: "upload failed: 422" });
    });

    it("CONTROL - only the two coded refusals are permanent (PHOTO_TOO_LARGE, UNSUPPORTED_PHOTO_TYPE); 415, 500 and 503 keep their text and stay queued, a 200 still succeeds", async () => {
        const up = createWebMediaUploader("insp-1", docWithPhotos("r2/base.jpg"));
        fetchMock.mockResolvedValue(jsonResponse({ error: "no" }, 415));
        expect(await up.upload(photoRec())).toEqual({ ok: false, error: "upload failed: 415" });
        fetchMock.mockResolvedValue(jsonResponse({ error: "no", code: "PHOTO_TOO_LARGE" }, 413));
        expect(await up.upload(photoRec())).toEqual({ ok: false, error: "TOO_LARGE", permanent: true });
        fetchMock.mockResolvedValue(jsonResponse({ error: "Upstream answered 400", code: "UNSUPPORTED_PHOTO_TYPE" }, 400));
        expect(await up.upload(photoRec())).toEqual({ ok: false, error: "UNSUPPORTED_TYPE", permanent: true });
        for (const status of [500, 503, 429, 401]) {
            fetchMock.mockResolvedValue(jsonResponse({ error: "no" }, status));
            expect(await up.upload(photoRec())).toEqual({ ok: false, error: `upload failed: ${status}` });
        }
        fetchMock.mockResolvedValue(jsonResponse({ data: { key: "k1" } }));
        expect(await up.upload(photoRec())).toEqual({ ok: true, key: "k1" });
    });

    it("without a results document a photo still uploads, a crop and an annotation fail without sending", async () => {
        fetchMock.mockResolvedValue(jsonResponse({ data: { key: "k1" } }));
        const up = createWebMediaUploader("insp-1", null);
        expect(await up.upload(photoRec())).toEqual({ ok: true, key: "k1" });
        fetchMock.mockClear();
        expect(await up.upload(cropRec())).toEqual({ ok: false, error: "no results document to resolve the photo in" });
        expect(await up.upload(annotRec())).toEqual({ ok: false, error: "no results document to resolve the photo in" });
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe("a mixed batch through the real web uploader result shape", () => {
    it("turns an unsupported type into the fixed sentence next to the uploaded count, and a 413 into the too-large one", async () => {
        const answers: Array<[number, unknown]> = [
            [200, { data: { key: "k1" } }],
            [400, { error: "Upstream answered 400", code: "UNSUPPORTED_PHOTO_TYPE" }],
            [413, { error: "Upstream answered 413", code: "PHOTO_TOO_LARGE" }],
            [400, { error: "Upstream answered 400", code: "validation_error" }],
        ];
        let call = 0;
        fetchMock.mockImplementation(async () => {
            const [status, body] = answers[call++] ?? [500, {}];
            return jsonResponse(body, status);
        });
        const up = createWebMediaUploader("insp-1", null);
        const results: MediaFileResult[] = [];
        for (let i = 0; i < 4; i++) {
            const r = await up.upload(photoRec());
            results.push(r.ok ? { index: i, ok: true, key: r.key } : { index: i, ok: false, error: r.error });
        }
        expect(results.map((r) => r.error)).toEqual([undefined, "UNSUPPORTED_TYPE", "TOO_LARGE", "upload failed: 400"]);
        expect(onlinePhotoRejectionMessages(results)).toEqual([
            m.editor_route_photos_partial_upload({ success: 1, total: 4, failed: 3 }),
            m.editor_route_photo_unsupported_type({ count: 1, s: "" }),
            m.editor_route_photo_too_large_single(),
        ]);
    });

    it("turns a 413 into the fixed too-large sentence next to the uploaded count", async () => {
        const statuses = [200, 200, 200, 413];
        let call = 0;
        fetchMock.mockImplementation(async () => {
            const status = statuses[call++] ?? 500;
            return jsonResponse(status === 200 ? { data: { key: `k${call}` } } : { error: "Upstream answered 413", code: "PHOTO_TOO_LARGE" }, status);
        });
        const up = createWebMediaUploader("insp-1", null);
        const results: MediaFileResult[] = [];
        for (let i = 0; i < 4; i++) {
            const r = await up.upload(photoRec());
            results.push(r.ok ? { index: i, ok: true, key: r.key } : { index: i, ok: false, error: r.error });
        }
        expect(results[3]).toEqual({ index: 3, ok: false, error: "TOO_LARGE" });
        expect(onlinePhotoRejectionMessages(results)).toEqual([
            m.editor_route_photos_partial_upload({ success: 3, total: 4, failed: 1 }),
            m.editor_route_photo_too_large_single(),
        ]);
    });

    it("CONTROL - a plain 413 in a batch is an unknown failure: retry wording, no too-large sentence", async () => {
        fetchMock.mockResolvedValue(jsonResponse({ error: "Upstream answered 413" }, 413));
        const r = await createWebMediaUploader("insp-1", null).upload(photoRec());
        expect(r).toEqual({ ok: false, error: "upload failed: 413" });
        expect(onlinePhotoRejectionMessages([{ index: 0, ok: false, error: r.ok ? "" : r.error }])).toEqual([
            m.editor_route_photos_partial_upload({ success: 0, total: 1, failed: 1 }),
        ]);
    });

    it("CONTROL - a 500 stays an unknown failure with no reason sentence", async () => {
        fetchMock.mockResolvedValue(jsonResponse({ error: "no" }, 500));
        const r = await createWebMediaUploader("insp-1", null).upload(photoRec());
        expect(r).toEqual({ ok: false, error: "upload failed: 500" });
        expect(onlinePhotoRejectionMessages([{ index: 0, ok: false, error: r.ok ? "" : r.error }])).toEqual([
            m.editor_route_photos_partial_upload({ success: 0, total: 1, failed: 1 }),
        ]);
    });
});
