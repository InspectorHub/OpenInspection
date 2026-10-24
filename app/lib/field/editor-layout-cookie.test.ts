// @vitest-environment node
import { describe, it, expect } from "vitest";
import { EDITOR_LAYOUT_COOKIE, layoutCookieString, layoutFromCookieHeader, parseEditorLayout, rememberEditorLayout } from "./editor-layout-cookie";

describe("parseEditorLayout", () => {
    it.each(["phone", "tablet", "desktop"] as const)("accepts %s", (v) => {
        expect(parseEditorLayout(v)).toBe(v);
    });
    it.each([
        "", " phone", "phone ", "PHONE", "Phone", "phone;", "phone,tablet", "<script>alert(1)</script>", "../../etc/passwd",
        "phone\r\nSet-Cookie: x=1", "constructor", "__proto__", "toString", "\u0000", "p".repeat(10_000),
        null, undefined, 0, 1, true, {}, [], ["phone"],
    ])("treats %j as desktop", (v) => {
        expect(parseEditorLayout(v)).toBe("desktop");
    });
});

describe("layoutFromCookieHeader", () => {
    it("reads the value among other cookies", () => {
        expect(layoutFromCookieHeader(`a=1; ${EDITOR_LAYOUT_COOKIE}=phone; b=2`)).toBe("phone");
        expect(layoutFromCookieHeader(`${EDITOR_LAYOUT_COOKIE}=tablet`)).toBe("tablet");
    });
    it("is desktop with no cookie, no header, or a value that is not exactly one of the three words", () => {
        expect(layoutFromCookieHeader(null)).toBe("desktop");
        expect(layoutFromCookieHeader(undefined)).toBe("desktop");
        expect(layoutFromCookieHeader("")).toBe("desktop");
        expect(layoutFromCookieHeader("a=1")).toBe("desktop");
        expect(layoutFromCookieHeader(`${EDITOR_LAYOUT_COOKIE}=`)).toBe("desktop");
        expect(layoutFromCookieHeader(`${EDITOR_LAYOUT_COOKIE}=phone%00`)).toBe("desktop");
        expect(layoutFromCookieHeader(`${EDITOR_LAYOUT_COOKIE}="phone"`)).toBe("desktop");
    });
    it("does not match a cookie whose name merely contains ours", () => {
        expect(layoutFromCookieHeader("x-" + "ih-" + "editor-layout=phone")).toBe("desktop");
        expect(layoutFromCookieHeader("ih-editor-layout2=phone")).toBe("desktop");
    });
});

describe("layoutCookieString", () => {
    it("is path-wide, lax, about a year, secure on https, and carries only the band", () => {
        const s = layoutCookieString("phone", true);
        expect(s).toBe("ih-editor-layout=phone; Path=/; Max-Age=31536000; SameSite=Lax; Secure");
        expect(layoutCookieString("tablet", false)).toBe("ih-editor-layout=tablet; Path=/; Max-Age=31536000; SameSite=Lax");
        expect(layoutCookieString("tablet", false)).not.toContain("Secure");
    });
    it("cannot be made to carry anything else", () => {
        expect(layoutCookieString("phone; Domain=evil.test" as never, true)).toContain("ih-editor-layout=desktop;");
    });
});

describe("rememberEditorLayout", () => {
    /** A cookie jar that records every assignment, like `document.cookie`. */
    function jar(initial = "") {
        const writes: string[] = [];
        let stored = initial;
        return {
            writes,
            doc: {
                get cookie() { return stored; },
                set cookie(v: string) { writes.push(v); stored = `${v.split(";")[0]}${stored ? `; ${stored}` : ""}`; },
            },
        };
    }

    it("writes once when the band differs from the stored one", () => {
        const { doc, writes } = jar("theme=dark");
        rememberEditorLayout("phone", doc, true);
        expect(writes).toEqual(["ih-editor-layout=phone; Path=/; Max-Age=31536000; SameSite=Lax; Secure"]);
    });
    it("writes nothing when the band is already the stored one, however often it is told", () => {
        const { doc, writes } = jar("ih-editor-layout=tablet");
        rememberEditorLayout("tablet", doc, true);
        rememberEditorLayout("tablet", doc, true);
        expect(writes).toEqual([]);
    });
    it("overwrites a stale band, and a second identical call is then a no-op", () => {
        const { doc, writes } = jar("ih-editor-layout=desktop");
        rememberEditorLayout("phone", doc, false);
        rememberEditorLayout("phone", doc, false);
        expect(writes).toHaveLength(1);
        expect(writes[0]).toContain("ih-editor-layout=phone");
        expect(writes[0]).not.toContain("Secure");
    });
    it("survives a cookie jar that throws", () => {
        const doc = { get cookie(): string { throw new Error("blocked"); }, set cookie(_v: string) { throw new Error("blocked"); } };
        expect(() => rememberEditorLayout("phone", doc, true)).not.toThrow();
    });
    it("does nothing without a document (server)", () => {
        expect(() => rememberEditorLayout("phone", undefined, true)).not.toThrow();
    });
});
