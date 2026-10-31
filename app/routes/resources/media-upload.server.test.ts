/**
 * The BFF relay behind the offline media drain.
 *
 * What these pin: no session means no upstream call at all; a signed-in request
 * is forwarded to the endpoint its `kind` names, with the fields that endpoint
 * reads; the API's `data` object comes back in the shape the web uploader reads;
 * and a request that cannot be addressed (unknown kind, no inspection id, no
 * item, a bad photo index) is refused before anything is forwarded.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const uploadPost = vi.fn();
const cropPost = vi.fn();
const annotationPost = vi.fn();

vi.mock("~/lib/session.server", () => ({ getToken: vi.fn() }));
vi.mock("~/lib/api-client.server", () => ({
    createApi: vi.fn(() => ({
        inspections: {
            ":id": {
                upload: { $post: (...a: unknown[]) => uploadPost(...a) },
                items: {
                    ":itemId": {
                        photos: {
                            ":photoIndex": {
                                crop: { $post: (...a: unknown[]) => cropPost(...a) },
                                annotation: { $post: (...a: unknown[]) => annotationPost(...a) },
                            },
                        },
                    },
                },
            },
        },
    })),
}));

import { action } from "./media-upload";
import { getToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { routeArgs } from "../../../tests/helpers/route-args";

const getTokenMock = vi.mocked(getToken);
const createApiMock = vi.mocked(createApi);
const CONTEXT = {} as Parameters<typeof action>[0]["context"];

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function post(fields: Record<string, string | Blob>) {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) {
        if (typeof v === "string") form.append(k, v);
        else form.append(k, new File([v], "x.bin", { type: v.type }));
    }
    return action(routeArgs(
        new Request("https://x/resources/media-upload", { method: "POST", body: form }),
        { params: {}, context: CONTEXT },
    ));
}

const jpeg = new Blob(["jpeg"], { type: "image/jpeg" });
const png = new Blob(["png"], { type: "image/png" });

function noUpstreamCalls(): void {
    expect(uploadPost).not.toHaveBeenCalled();
    expect(cropPost).not.toHaveBeenCalled();
    expect(annotationPost).not.toHaveBeenCalled();
}

beforeEach(() => {
    vi.clearAllMocks();
    getTokenMock.mockResolvedValue("jwt");
    uploadPost.mockResolvedValue(json({ data: { key: "r2/new.jpg", itemId: "i1" } }));
    cropPost.mockResolvedValue(json({ data: { croppedKey: "r2/c.jpg" } }));
    annotationPost.mockResolvedValue(json({ data: { annotatedKey: "r2/a.png" } }));
});

describe("media-upload relay: session", () => {
    it("answers 401 and never touches the API without a session", async () => {
        getTokenMock.mockResolvedValue(null);
        const res = await post({ kind: "photo", inspectionId: "insp-1", itemId: "i1", file: jpeg });
        expect(res.status).toBe(401);
        expect(createApiMock).not.toHaveBeenCalled();
        noUpstreamCalls();
    });

    it("builds the API client with the session token", async () => {
        await post({ kind: "photo", inspectionId: "insp-1", itemId: "i1", file: jpeg });
        expect(createApiMock).toHaveBeenCalledWith(CONTEXT, { token: "jwt" });
    });
});

describe("media-upload relay: forwarding by kind", () => {
    it("photo -> POST /upload with the file and item, returns the key", async () => {
        const res = await post({ kind: "photo", inspectionId: "insp-1", itemId: "i1", file: jpeg });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ data: { key: "r2/new.jpg", itemId: "i1" } });
        expect(uploadPost).toHaveBeenCalledTimes(1);
        const arg = uploadPost.mock.calls[0][0] as { param: { id: string }; form: { file: File; itemId: string } };
        expect(arg.param).toEqual({ id: "insp-1" });
        expect(arg.form.itemId).toBe("i1");
        expect(arg.form.file).toBeInstanceOf(File);
        expect(cropPost).not.toHaveBeenCalled();
        expect(annotationPost).not.toHaveBeenCalled();
    });

    it("crop -> POST .../photos/:index/crop with the transform and section, returns croppedKey", async () => {
        const res = await post({
            kind: "crop", inspectionId: "insp-1", itemId: "i1", photoIndex: "2",
            sectionId: "s1", crop: '{"x":1}', image: jpeg,
        });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ data: { croppedKey: "r2/c.jpg" } });
        const arg = cropPost.mock.calls[0][0] as { param: Record<string, string>; form: Record<string, unknown> };
        expect(arg.param).toEqual({ id: "insp-1", itemId: "i1", photoIndex: "2" });
        expect(arg.form.crop).toBe('{"x":1}');
        expect(arg.form.sectionId).toBe("s1");
        expect(arg.form.image).toBeInstanceOf(File);
        expect(uploadPost).not.toHaveBeenCalled();
        expect(annotationPost).not.toHaveBeenCalled();
    });

    it("crop without a section sends no sectionId", async () => {
        await post({ kind: "crop", inspectionId: "insp-1", itemId: "i1", photoIndex: "0", crop: "{}", image: jpeg });
        const arg = cropPost.mock.calls[0][0] as { form: Record<string, unknown> };
        expect("sectionId" in arg.form).toBe(false);
    });

    it("annotate -> POST .../photos/:index/annotation with the node tree, returns annotatedKey", async () => {
        const res = await post({
            kind: "annotate", inspectionId: "insp-1", itemId: "i1", photoIndex: "0",
            nodes: '[{"t":"rect"}]', image: png,
        });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ data: { annotatedKey: "r2/a.png" } });
        const arg = annotationPost.mock.calls[0][0] as { param: Record<string, string>; form: Record<string, unknown> };
        expect(arg.param).toEqual({ id: "insp-1", itemId: "i1", photoIndex: "0" });
        expect(arg.form.nodes).toBe('[{"t":"rect"}]');
        expect(arg.form.image).toBeInstanceOf(File);
        expect(uploadPost).not.toHaveBeenCalled();
        expect(cropPost).not.toHaveBeenCalled();
    });
});

describe("media-upload relay: refuses what it cannot address", () => {
    it("unknown kind -> 400, nothing forwarded", async () => {
        const res = await post({ kind: "video", inspectionId: "insp-1", itemId: "i1", file: jpeg });
        expect(res.status).toBe(400);
        noUpstreamCalls();
    });

    it("missing kind -> 400", async () => {
        const res = await post({ inspectionId: "insp-1", itemId: "i1", file: jpeg });
        expect(res.status).toBe(400);
        noUpstreamCalls();
    });

    it("absent inspection id -> 400, nothing forwarded (every kind)", async () => {
        for (const kind of ["photo", "crop", "annotate"]) {
            const res = await post({ kind, itemId: "i1", photoIndex: "0", crop: "{}", nodes: "[]", file: jpeg, image: jpeg });
            expect(res.status).toBe(400);
        }
        noUpstreamCalls();
    });

    // The typed client builds the request path by pasting these values in without encoding them, so a value
    // like `../../admin/x?y=` would leave the API prefix and inject a query. Ids come from client form fields
    // here (not from route params, which cannot contain a slash), so the route refuses anything that is not a
    // single path segment before it builds a call.
    it("refuses an inspection or item id that is not a single path segment, for every kind (nothing forwarded)", async () => {
        const bad = ["../../../admin/x?y=", "a/../b", "a/b", "a?b", "a#b", "a%2Fb", "%2e%2e", "..", ".", "a\\b"];
        for (const value of bad) {
            for (const kind of ["photo", "crop", "annotate"]) {
                const rest = { kind, photoIndex: "0", crop: "{}", nodes: "[]", file: jpeg, image: jpeg };
                const badInspection = await post({ ...rest, inspectionId: value, itemId: "i1" });
                expect(badInspection.status, `inspectionId ${value} (${kind})`).toBe(400);
                const badItem = await post({ ...rest, inspectionId: "insp-1", itemId: value });
                expect(badItem.status, `itemId ${value} (${kind})`).toBe(400);
            }
        }
        noUpstreamCalls();
    });

    it("still forwards ordinary ids: a UUID inspection id and item ids with dashes, underscores and dots", async () => {
        for (const itemId of ["roof", "roof-covering", "roof_2", "item.3"]) {
            const res = await post({ kind: "photo", inspectionId: "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f", itemId, file: jpeg });
            expect(res.status, itemId).toBe(200);
        }
        expect(uploadPost).toHaveBeenCalledTimes(4);
    });

    it("absent item id -> 400", async () => {
        const res = await post({ kind: "photo", inspectionId: "insp-1", file: jpeg });
        expect(res.status).toBe(400);
        noUpstreamCalls();
    });

    it("photo without a file -> 400", async () => {
        const res = await post({ kind: "photo", inspectionId: "insp-1", itemId: "i1" });
        expect(res.status).toBe(400);
        noUpstreamCalls();
    });

    it("derivative with a missing, negative or fractional photoIndex -> 400", async () => {
        for (const photoIndex of [undefined, "-1", "1.5", "abc"]) {
            const fields: Record<string, string | Blob> = { kind: "crop", inspectionId: "insp-1", itemId: "i1", crop: "{}", image: jpeg };
            if (photoIndex !== undefined) fields.photoIndex = photoIndex;
            const res = await post(fields);
            expect(res.status).toBe(400);
        }
        noUpstreamCalls();
    });

    it("crop without a transform / annotate without nodes -> 400", async () => {
        const a = await post({ kind: "crop", inspectionId: "insp-1", itemId: "i1", photoIndex: "0", image: jpeg });
        const b = await post({ kind: "annotate", inspectionId: "insp-1", itemId: "i1", photoIndex: "0", image: png });
        expect(a.status).toBe(400);
        expect(b.status).toBe(400);
        noUpstreamCalls();
    });
});

describe("media-upload relay: upstream failures", () => {
    it("a non-OK upstream answer comes back with the same status", async () => {
        uploadPost.mockResolvedValue(json({ error: "nope" }, 403));
        const res = await post({ kind: "photo", inspectionId: "insp-1", itemId: "i1", file: jpeg });
        expect(res.status).toBe(403);
    });

    it("passes the API's stable error code through, and a different 400 carries its own code", async () => {
        uploadPost.mockResolvedValue(json({ success: false, error: { message: "Photo is not a jpeg, png or heic image", code: "UNSUPPORTED_PHOTO_TYPE" } }, 400));
        const refused = await post({ kind: "photo", inspectionId: "insp-1", itemId: "i1", file: jpeg });
        expect(refused.status).toBe(400);
        expect(await refused.json()).toEqual({ error: "Upstream answered 400", code: "UNSUPPORTED_PHOTO_TYPE" });
        // CONTROL: another 400 relays its own code, never the photo-type one.
        uploadPost.mockResolvedValue(json({ success: false, error: { message: "Validation failed", code: "validation_error" } }, 400));
        const other = await post({ kind: "photo", inspectionId: "insp-1", itemId: "i1", file: jpeg });
        expect(await other.json()).toEqual({ error: "Upstream answered 400", code: "validation_error" });
        // CONTROL: an answer with no readable envelope has no code at all.
        uploadPost.mockResolvedValue(new Response("<html>nope</html>", { status: 400 }));
        const bare = await post({ kind: "photo", inspectionId: "insp-1", itemId: "i1", file: jpeg });
        expect(await bare.json()).toEqual({ error: "Upstream answered 400" });
    });

    it("a thrown upstream call answers 502, never 200", async () => {
        cropPost.mockRejectedValue(new Error("network"));
        const res = await post({ kind: "crop", inspectionId: "insp-1", itemId: "i1", photoIndex: "0", crop: "{}", image: jpeg });
        expect(res.status).toBe(502);
    });
});
