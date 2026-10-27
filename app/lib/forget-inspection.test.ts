// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { forgetInspectionInServiceWorker } from "~/lib/forget-inspection";

afterEach(() => vi.unstubAllGlobals());

const withWorker = (controller: unknown) => vi.stubGlobal("navigator", { serviceWorker: { controller } });

describe("forgetInspectionInServiceWorker", () => {
    it("posts the id to the controlling worker", () => {
        const postMessage = vi.fn();
        withWorker({ postMessage });
        forgetInspectionInServiceWorker("3f2b8c1e-9a4d-4e6b-8c11-0a1b2c3d4e5f");
        expect(postMessage).toHaveBeenCalledExactlyOnceWith({ type: "forget-inspection", id: "3f2b8c1e-9a4d-4e6b-8c11-0a1b2c3d4e5f" });
    });

    it("does nothing without a controller, without service worker support, or on the server", () => {
        withWorker(null);
        expect(() => forgetInspectionInServiceWorker("x")).not.toThrow();
        vi.stubGlobal("navigator", {});
        expect(() => forgetInspectionInServiceWorker("x")).not.toThrow();
        vi.stubGlobal("navigator", undefined);
        expect(() => forgetInspectionInServiceWorker("x")).not.toThrow();
    });

    it("never throws when the worker refuses the message", () => {
        withWorker({ postMessage: () => { throw new Error("detached"); } });
        expect(() => forgetInspectionInServiceWorker("x")).not.toThrow();
    });
});
