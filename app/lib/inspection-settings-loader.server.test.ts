// @vitest-environment node
/**
 * The settings read the hub loader and the resource route share: the full
 * shape from a complete api-client, and the empty shape — never a throw —
 * from a narrower mock or a failed read.
 */
import { describe, it, expect } from "vitest";
import { loadInspectionSettings } from "./inspection-settings-loader.server";

const okJson = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ data }) }) as unknown as Response;

function fakeApi(overrides: Record<string, unknown> = {}): never {
    return {
        inspections: {
            ":id": {
                $get: async () => okJson({ inspection: { id: "i1", templateId: "t1", coverPhotoId: "p1" } }),
                media: { $get: async () => okJson({ results: { data: {} } }) },
            },
            templates: { $get: async () => okJson([{ id: "t1", name: "Full" }]) },
        },
        ...overrides,
    } as never;
}

describe("loadInspectionSettings", () => {
    it("returns the inspection, templates, photos and profiles", async () => {
        const sheet = await loadInspectionSettings(fakeApi(), "i1");
        expect(sheet.inspection?.templateId).toBe("t1");
        expect(sheet.templates).toEqual([{ id: "t1", name: "Full" }]);
        expect(sheet.photos).toEqual([]);
        expect(sheet.profiles.map((p) => p.id)).toContain("signature");
    });

    it("answers the empty shape when the id is missing", async () => {
        const sheet = await loadInspectionSettings(fakeApi(), "");
        expect(sheet.inspection).toBeNull();
        expect(sheet.templates).toEqual([]);
    });

    it("degrades to the empty shape on a narrower mocked client, without throwing", async () => {
        // The hub's SMS-consent tests mock only the endpoints they exercise;
        // the settings read must not throw on the missing properties.
        const narrow = { inspections: { ":id": { hub: { $get: async () => okJson({}) } } } } as never;
        const sheet = await loadInspectionSettings(narrow, "i1");
        expect(sheet.inspection).toBeNull();
        expect(sheet.templates).toEqual([]);
        expect(sheet.photos).toEqual([]);
    });

    it("degrades to the empty shape when a read fails", async () => {
        const failing = fakeApi({
            inspections: {
                ":id": {
                    $get: async () => {
                        throw new Error("down");
                    },
                    media: { $get: async () => okJson({ results: { data: {} } }) },
                },
                templates: { $get: async () => okJson([{ id: "t1", name: "Full" }]) },
            },
        });
        const sheet = await loadInspectionSettings(failing, "i1");
        expect(sheet.inspection).toBeNull();
        expect(sheet.templates).toEqual([{ id: "t1", name: "Full" }]);
    });
});
