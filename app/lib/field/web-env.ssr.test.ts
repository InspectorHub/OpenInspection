// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { webIsOnline, webOnOnlineChange } from "./web-env";

afterEach(() => vi.unstubAllGlobals());

describe("web-env on the server", () => {
    it("has no window here", () => {
        expect(typeof window).toBe("undefined");
    });

    it("webIsOnline is true when navigator exists without onLine (Node 21+, workerd)", () => {
        vi.stubGlobal("navigator", { userAgent: "Cloudflare-Workers" });
        expect(webIsOnline()).toBe(true);
    });

    it("webIsOnline is true when navigator is absent", () => {
        vi.stubGlobal("navigator", undefined);
        expect(webIsOnline()).toBe(true);
    });

    it("webOnOnlineChange returns a callable no-op without window", () => {
        const off = webOnOnlineChange(() => { throw new Error("must not fire"); });
        expect(() => off()).not.toThrow();
    });
});
