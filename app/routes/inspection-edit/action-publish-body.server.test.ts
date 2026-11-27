// @vitest-environment node
/**
 * The JSON body of the editor's publish request, read from the form.
 *
 * Blank or absent sends nothing for a field, so the server's default applies
 * rather than an empty string that would record a reason nobody wrote or a
 * translation nobody asked for.
 */
import { describe, it, expect } from "vitest";
import { publishBody } from "./action-publish-body.server";

function form(entries: Array<[string, string]>): FormData {
    const fd = new FormData();
    for (const [k, v] of entries) fd.append(k, v);
    return fd;
}

describe("publishBody", () => {
    it("sends nothing for an empty form", () => {
        expect(publishBody(form([]))).toEqual({});
    });

    it("carries a trimmed summary and drops a blank one", () => {
        expect(publishBody(form([["summary", "  Fixed it.  "]]))).toEqual({ summary: "Fixed it." });
        expect(publishBody(form([["summary", "   "]]))).toEqual({});
    });

    it("sends notifyClient only on an explicit true", () => {
        expect(publishBody(form([["notifyClient", "true"]]))).toEqual({ notifyClient: true });
        expect(publishBody(form([["notifyClient", "false"]]))).toEqual({});
        expect(publishBody(form([["notifyClient", "on"]]))).toEqual({});
    });

    // #506 — the courtesy-translation opt-in rides as the locale, or absent.
    it("carries translateTo as the locale and drops a blank one", () => {
        expect(publishBody(form([["translateTo", "es-419"]]))).toEqual({ translateTo: "es-419" });
        expect(publishBody(form([["translateTo", "   "]]))).toEqual({});
    });

    it("carries the three fields together", () => {
        expect(
            publishBody(form([["summary", "Rev 2"], ["notifyClient", "true"], ["translateTo", "es-419"]])),
        ).toEqual({ summary: "Rev 2", notifyClient: true, translateTo: "es-419" });
    });
});
