// @vitest-environment node
import { describe, it, expect } from "vitest";
import { headers } from "../inspection-edit";

describe("editor document headers", () => {
    it("is private (no shared cache) and varies on the cookie that carries the remembered layout", () => {
        const h = headers({ loaderHeaders: new Headers() });
        expect(h.get("Cache-Control")).toBe("private");
        expect(h.get("Vary")).toBe("Cookie");
    });
    it("forwards only Set-Cookie from the loader, never a caching directive", () => {
        const h = headers({ loaderHeaders: new Headers({ "Set-Cookie": "a=1; Path=/", "Cache-Control": "public, max-age=600", Vary: "Accept" }) });
        expect(h.get("Set-Cookie")).toBe("a=1; Path=/");
        expect(h.get("Cache-Control")).toBe("private");
        expect(h.get("Vary")).toBe("Cookie");
    });
});
