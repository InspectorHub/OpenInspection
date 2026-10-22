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
    it("equals what usePresence built from window.location before it read the data source", () => {
        // The formula the hook used (verbatim from the old call site), evaluated for each scheme.
        const old = (loc: { protocol: string; host: string }, id: string) => {
            const protocol = loc.protocol === "https:" ? "wss:" : "ws:";
            return `${protocol}//${loc.host}/api/inspections/${id}/presence/ws`;
        };
        for (const loc of [
            { protocol: "https:", host: "app.inspectorhub.io" },
            { protocol: "http:", host: "localhost:8787" },
            { protocol: "http:", host: "192.168.1.20:8787" },
        ]) {
            expect(createWebUrls(loc).presenceSocket("insp-9")).toBe(old(loc, "insp-9"));
        }
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
        ["packages/field-ui/src/components/media-studio/VideoPlayer.tsx", ["urls.videoObject(inspectionId, mediaId)"]],
        [
            "packages/field-ui/src/hooks/usePresence.ts",
            ["dataSource.urls.presenceSocket(inspectionId)"],
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
