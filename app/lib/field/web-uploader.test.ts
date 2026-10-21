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
import { createWebUploader } from "./web-uploader";

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
