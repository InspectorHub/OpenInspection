/**
 * `pickSettingsFields` is the allow-list that keeps the hub's settings section
 * from becoming a general-purpose inspection PATCH.
 *
 * `UpdateInspectionSchema` also accepts `status`, the order facts and the
 * property facts. Each of those has its own surface with its own rules — the
 * publish lifecycle owns `status`, the order cards own the order facts — so a
 * settings form quietly carrying one through would be a real hole rather than
 * a style point. The template is an attribute field (a property fact); the
 * required-fields override, the profile override and the cover are
 * inspection-side fields, never written by an office user.
 */
import { describe, it, expect } from "vitest";
import { pickSettingsFields, handleSaveSettings, handleSetCover, handleUploadCover, handleCropCover } from "./inspection-settings-actions";
import { ATTRIBUTE_FIELDS, INSPECTION_SIDE_FIELDS } from "../../server/lib/inspection/order-fields";
import { UpdateInspectionSchema } from "../../server/lib/validations/inspection.schema";
import type { Api } from "./api-client.server";

const res = (status: number, body: unknown = {}) => ({
    ok: status < 400,
    status,
    json: async () => body,
});

function formData(entries: Record<string, unknown>): FormData {
    const fd = new FormData();
    for (const [k, v] of Object.entries(entries)) fd.set(k, v as string);
    return fd;
}

/** A fake Api carrying only the inspection subtree the settings handlers call. */
function fakeApi(patch: ReturnType<typeof res>, upload?: ReturnType<typeof res>, crop?: ReturnType<typeof res>): Api {
    const calls: unknown[] = [];
    return {
        inspections: {
            ":id": {
                $patch: async (args: unknown) => {
                    calls.push(["patch", args]);
                    return patch;
                },
                media: {
                    upload: {
                        $post: async (args: unknown) => {
                            calls.push(["upload", args]);
                            return upload ?? res(200, { data: { key: "k1", url: "https://x/k1" } });
                        },
                    },
                },
                cover: {
                    $post: async (args: unknown) => {
                        calls.push(["crop", args]);
                        return crop ?? res(200, { data: { coverImageKey: "k2" } });
                    },
                },
            },
        },
        __calls: calls,
    } as unknown as Api;
}

describe("pickSettingsFields", () => {
    it("keeps every field the settings section edits", () => {
        expect(
            pickSettingsFields({ templateId: "tpl-1", requireDefectFieldsOverride: "both", profileOverride: "meridian" }),
        ).toEqual({ templateId: "tpl-1", requireDefectFieldsOverride: "both", profileOverride: "meridian" });
    });

    it("drops fields that belong to another surface", () => {
        expect(
            pickSettingsFields({
                templateId: "tpl-1",
                status: "completed",
                price: 100,
                coverPhotoId: "tenant/insp/x.jpg",
                propertyAddress: "somewhere else",
            }),
        ).toEqual({ templateId: "tpl-1" });
    });

    it("passes null through — it is how an override is cleared back to inherit", () => {
        expect(pickSettingsFields({ requireDefectFieldsOverride: null, profileOverride: null })).toEqual({
            requireDefectFieldsOverride: null,
            profileOverride: null,
        });
    });

    it("omits absent keys so a one-field save PATCHes one field", () => {
        expect(pickSettingsFields({ profileOverride: "terra" })).toEqual({ profileOverride: "terra" });
    });
});

describe("pickSettingsFields vs the server classification", () => {
    it("writes only keys that are attribute or inspection-side fields on the server", () => {
        const everything = Object.fromEntries(Object.keys(UpdateInspectionSchema.shape).map((k) => [k, 1]));
        const clientKeys = Object.keys(pickSettingsFields(everything));
        expect(clientKeys.length).toBe(3);
        expect(
            clientKeys.filter(
                (k) => !(ATTRIBUTE_FIELDS as readonly string[]).includes(k) && !(INSPECTION_SIDE_FIELDS as readonly string[]).includes(k),
            ),
        ).toEqual([]);
    });
});

describe("handleSaveSettings", () => {
    it("PATCHes the picked fields and reports the API answer", async () => {
        const api = fakeApi(res(200));
        const out = await handleSaveSettings(api, "insp-1", formData({ payload: JSON.stringify({ templateId: "tpl-1", price: 100 }) }));
        expect(out).toEqual({ ok: true, intent: "save-settings", error: undefined });
        expect((api as unknown as { __calls: unknown[] }).__calls).toEqual([
            ["patch", { param: { id: "insp-1" }, json: { templateId: "tpl-1" } }],
        ]);
    });

    it("refuses unparsable payloads without calling the API", async () => {
        const api = fakeApi(res(200));
        const out = await handleSaveSettings(api, "insp-1", formData({ payload: "{nope" }));
        expect(out.ok).toBe(false);
        expect(out.error).toMatch(/save the settings/i);
        expect((api as unknown as { __calls: unknown[] }).__calls).toEqual([]);
    });

    it("carries a refused PATCH back as not-ok", async () => {
        const out = await handleSaveSettings(fakeApi(res(400, { error: { message: "Nope." } })), "insp-1", formData({ payload: "{}" }));
        expect(out.ok).toBe(false);
        expect(out.error).toBe("Nope.");
    });
});

describe("handleSetCover", () => {
    it("PATCHes the cover key, and clears it on an empty value", async () => {
        const api = fakeApi(res(200));
        expect(await handleSetCover(api, "insp-1", formData({ coverPhotoId: "tenant/insp/x.jpg" }))).toEqual({
            ok: true,
            intent: "set-cover",
            error: undefined,
        });
        expect(await handleSetCover(api, "insp-1", formData({}))).toEqual({ ok: true, intent: "set-cover", error: undefined });
        expect((api as unknown as { __calls: unknown[] }).__calls).toEqual([
            ["patch", { param: { id: "insp-1" }, json: { coverPhotoId: "tenant/insp/x.jpg" } }],
            ["patch", { param: { id: "insp-1" }, json: { coverPhotoId: null } }],
        ]);
    });
});

describe("handleUploadCover", () => {
    it("uploads, sets the cover, and returns the new key and url", async () => {
        const api = fakeApi(res(200));
        const fd = new FormData();
        fd.set("file", new File(["x"], "cover.jpg", { type: "image/jpeg" }));
        const out = await handleUploadCover(api, "insp-1", fd);
        expect(out).toEqual({ ok: true, intent: "upload-cover", error: undefined, coverKey: "k1", coverUrl: "https://x/k1" });
    });

    it("refuses a missing file without calling the API", async () => {
        const api = fakeApi(res(200));
        expect((await handleUploadCover(api, "insp-1", new FormData())).ok).toBe(false);
        expect((api as unknown as { __calls: unknown[] }).__calls).toEqual([]);
    });

    it("a failed upload reports not-ok and never PATCHes", async () => {
        const api = fakeApi(res(200), res(400, { error: { message: "Too big." } }));
        const fd = new FormData();
        fd.set("file", new File(["x"], "cover.jpg", { type: "image/jpeg" }));
        const out = await handleUploadCover(api, "insp-1", fd);
        expect(out.ok).toBe(false);
        expect(out.error).toBe("Too big.");
        expect((api as unknown as { __calls: unknown[] }).__calls).toEqual([["upload", expect.anything()]]);
    });
});

describe("handleCropCover", () => {
    it("posts the crop and returns the new cover key", async () => {
        const api = fakeApi(res(200));
        const fd = new FormData();
        fd.set("image", new File(["x"], "cover.jpg", { type: "image/jpeg" }));
        fd.set("sourceKey", "tenant/insp/x.jpg");
        fd.set("crop", JSON.stringify({ x: 0, y: 0, width: 100, height: 100 }));
        const out = await handleCropCover(api, "insp-1", fd);
        expect(out).toEqual({ ok: true, intent: "crop-cover", error: undefined, coverKey: "k2" });
    });

    it("refuses a missing image or source key without calling the API", async () => {
        const api = fakeApi(res(200));
        expect((await handleCropCover(api, "insp-1", new FormData())).ok).toBe(false);
        const fd = new FormData();
        fd.set("image", new File(["x"], "cover.jpg", { type: "image/jpeg" }));
        expect((await handleCropCover(api, "insp-1", fd)).ok).toBe(false);
        expect((api as unknown as { __calls: unknown[] }).__calls).toEqual([]);
    });
});
