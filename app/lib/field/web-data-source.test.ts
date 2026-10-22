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

    it("execute goes through the transport when an inspection is present", async () => {
        const transport = vi.fn(async () => ({ ok: true })) as unknown as WebExecute;
        await make({ transport }).execute("insp-1", { type: "complete" } as never, { idempotencyKey: "k" });
        expect(transport).toHaveBeenCalledWith("insp-1", { type: "complete" }, { idempotencyKey: "k" });
    });
});
