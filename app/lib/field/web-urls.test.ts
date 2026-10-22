import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createWebUrls } from "./web-urls";

/**
 * Golden strings. These literals mirror the call sites listed in the "call sites" block
 * at the bottom of this file. A batch that converts one of those call sites to `FieldUrls`
 * must re-run this file: it passes only while the adapter and the not-yet-converted call
 * sites still build the same string.
 */

const urls = createWebUrls();

describe("createWebUrls golden strings", () => {
    it("photo encodes the key", () => {
        expect(urls.photo("i1", "a/b c.jpg")).toBe("/api/inspections/i1/photo?key=a%2Fb%20c.jpg");
    });
    it("reportPreview needs a slug", () => {
        expect(urls.reportPreview("acme", "i1")).toBe("/report-view/acme/i1");
        expect(urls.reportPreview("", "i1")).toBeNull();
    });
    it("reportPdf carries ?type=full", () => {
        expect(urls.reportPdf("i1")).toBe("/api/inspections/i1/pdf?type=full");
    });
    it("statutoryPreviewPdf", () => {
        expect(urls.statutoryPreviewPdf("i1")).toBe("/api/inspections/i1/statutory-form/preview.pdf");
    });
    it("videoObject is null for an empty ref", () => {
        expect(urls.videoObject("i1", "m9")).toBe("/api/inspections/i1/media/video/r2-object/m9");
        expect(urls.videoObject("i1", "")).toBeNull();
    });
    it("editorPath", () => {
        expect(urls.editorPath("i1")).toBe("/inspections/i1/edit");
    });
});

describe("presenceSocket", () => {
    it("uses wss for https and ws otherwise, from an injected location", () => {
        expect(createWebUrls({ protocol: "https:", host: "app.example.com" }).presenceSocket("i1")).toBe(
            "wss://app.example.com/api/inspections/i1/presence/ws",
        );
        expect(createWebUrls({ protocol: "http:", host: "localhost:8787" }).presenceSocket("i1")).toBe(
            "ws://localhost:8787/api/inspections/i1/presence/ws",
        );
    });
    it("throws a clear error on the server when no location was injected", () => {
        expect(typeof window).toBe("undefined");
        expect(() => createWebUrls().presenceSocket("i1")).toThrow(/browser location/);
    });
});

describe("call sites still build the same fragments", () => {
    const read = (rel: string) => readFileSync(path.resolve(__dirname, "../../..", rel), "utf8");
    const sites: Array<[string, string[]]> = [
        ["app/components/editor/ItemEditor.tsx", ["/api/inspections/${inspectionId}/photo?key=${encodeURIComponent(k)}"]],
        ["app/components/editor/SideRail.tsx", ["/api/inspections/${inspectionId}/photo?key=${encodeURIComponent(key)}"]],
        ["app/hooks/usePhotoOps.ts", ["/api/inspections/${state.inspection.id}/photo?key=${encodeURIComponent("]],
        [
            "app/components/editor/EditorHeader.tsx",
            ["/report-view/${tenantSlug}/${state.inspection.id}", "/api/inspections/${state.inspection.id}/pdf?type=full"],
        ],
        ["app/components/media-studio/VideoPlayer.tsx", ["/api/inspections/${inspectionId}/media/video/r2-object/${mediaId}"]],
        [
            "app/hooks/usePresence.ts",
            ['window.location.protocol === "https:" ? "wss:" : "ws:"', "//${window.location.host}/api/inspections/${inspectionId}/presence/ws"],
        ],
        ["app/routes/inspection-edit.tsx", ["/api/inspections/${loaderData.inspection.id}/statutory-form/preview.pdf"]],
        ["app/components/editor/PublishModal.tsx", ["/inspections/:id/edit"]],
    ];
    for (const [file, fragments] of sites) {
        it(file, () => {
            const text = read(file);
            for (const f of fragments) expect(text).toContain(f);
        });
    }
});
