import { describe, expect, it, vi } from "vitest";
import type { EditorData } from "@core/field-ui/data-source";
import { editorDataFromLoader } from "./web-editor-data";
import { loaderPayload } from "./web-editor-data.fixtures";
import { createWebFieldDataSource, type WebDataSourceParts } from "./web-data-source";
import type { WebExecute } from "./web-transport";

const BITS = { tenantSlug: null, videoProvider: "r2", streamCustomerSubdomain: null, collabEditing: false } as const;

function make(over: Partial<WebDataSourceParts> = {}) {
    const current: EditorData = editorDataFromLoader(loaderPayload());
    return createWebFieldDataSource({
        current: () => current,
        sessionBits: () => BITS,
        sessionContext: () => null,
        reload: () => undefined,
        exit: () => undefined,
        ...over,
    });
}

describe("createWebFieldDataSource", () => {
    it("openUrl opens a new tab without an opener", () => {
        const open = vi.fn();
        vi.stubGlobal("window", { open });
        try {
            make().openUrl?.("/report/x");
            expect(open).toHaveBeenCalledWith("/report/x", "_blank", "noopener");
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it("restartSession reloads the page, and does not go through the loader revalidation", () => {
        const pageReload = vi.fn();
        const revalidate = vi.fn();
        vi.stubGlobal("window", { location: { reload: pageReload } });
        try {
            make({ reload: revalidate }).restartSession?.();
            expect(pageReload).toHaveBeenCalledTimes(1);
            expect(revalidate).not.toHaveBeenCalled();
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it("load with a scope asks the transport for load-scope and merges the slice", async () => {
        const transport = vi.fn(async () => ({ ok: true, data: { scope: "u1", results: { "u1:a": { rating: "ok" } } } })) as unknown as WebExecute;
        const ds = make({ transport });
        const data = await ds.load("insp-1", "u1");
        expect(transport).toHaveBeenCalledWith("insp-1", { type: "load-scope", scope: "u1" });
        expect(data.results).toEqual({ "u1:a": { rating: "ok" } });
        expect(data.inspection.id).toBe("insp-1");
    });

    it("load with a scope throws when the transport fails", async () => {
        const transport = (async () => ({ ok: false, error: "nope" })) as unknown as WebExecute;
        await expect(make({ transport }).load("insp-1", "u1")).rejects.toThrow("nope");
    });

    it("serves the editor preferences resource", () => {
        const ds = make();
        expect(typeof ds.resources.prefs?.load).toBe("function");
        expect(typeof ds.resources.prefs?.patch).toBe("function");
        expect(typeof ds.resources.video?.setPoster).toBe("function");
    });

    it("serves the canned-comment library, in the editor and in a host with no inspection", () => {
        for (const ds of [make(), make({ current: () => null })]) {
            expect(typeof ds.resources.commentsLibrary?.list).toBe("function");
            expect(typeof ds.resources.commentsLibrary?.touch).toBe("function");
            expect(typeof ds.resources.commentsLibrary?.save).toBe("function");
            expect(typeof ds.resources.commentsLibrary?.edit).toBe("function");
        }
    });

    it("serves AI assistance and the cost-item read, in the editor and in a host with no inspection", () => {
        for (const ds of [make(), make({ current: () => null })]) {
            expect(typeof ds.resources.aiAssist?.run).toBe("function");
            expect(typeof ds.resources.costItems?.list).toBe("function");
        }
    });

    it("serves every resource the moved panels read, in the editor and in a host with no inspection", () => {
        for (const ds of [make(), make({ current: () => null })]) {
            expect(typeof ds.resources.templateSearch?.search).toBe("function");
            expect(typeof ds.resources.repairItems?.list).toBe("function");
            expect(typeof ds.resources.mediaPool?.list).toBe("function");
            expect(typeof ds.resources.settingsSheet?.load).toBe("function");
            expect(typeof ds.resources.versionHistory?.capture).toBe("function");
            expect(typeof ds.resources.costItems?.save).toBe("function");
            for (const member of ["createUpload", "uploadFile", "uploadPoster", "setPoster", "finalize", "remove"] as const) {
                expect(typeof ds.resources.video?.[member]).toBe("function");
            }
        }
    });

    it("provides every optional capability the editor hides its entry points for, so the web editor shows them all", () => {
        // The editor leaves an entry out when its resource is absent (FieldEditor.capabilities.test.tsx). The web
        // host must therefore keep providing each one: a member dropped here would silently remove a button.
        const CAPABILITIES = [
            "aiAssist",
            "commentsLibrary",
            "costItems",
            "mediaPool",
            "publishReadiness",
            "repairItems",
            "settingsSheet",
            "templateSearch",
            "versionHistory",
            "video",
        ] as const;
        for (const ds of [make(), make({ current: () => null })]) {
            for (const key of CAPABILITIES) expect(ds.resources[key], key).toBeDefined();
        }
    });

    it("hands the live results document to the media uploader, which answers instead of throwing", async () => {
        const ds = make();
        const rec = {
            kind: "crop", pendingId: "p", inspectionId: "insp-1", createdAt: 1, blob: new Blob(["c"]),
            meta: { findingKey: "_default:s:i", itemId: "i", photoIndex: 0, photoKey: "k", crop: { aspect: "free", orientation: "landscape", x: 0, y: 0, width: 1, height: 1 } },
        } as const;
        // No document: the crop cannot be addressed, so it fails without a network call.
        expect(await ds.media.uploader("insp-1", null).upload(rec)).toMatchObject({ ok: false });
    });

    it("execute goes through the transport when an inspection is present", async () => {
        const transport = vi.fn(async () => ({ ok: true })) as unknown as WebExecute;
        await make({ transport }).execute("insp-1", { type: "complete" } as never, { idempotencyKey: "k" });
        expect(transport).toHaveBeenCalledWith("insp-1", { type: "complete" }, { idempotencyKey: "k" });
    });
});
