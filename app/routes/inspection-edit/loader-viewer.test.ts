// @vitest-environment node
/**
 * The editor loader hands the page the viewer's display values, read from the session-context answer it
 * already fetches (no extra call): the editor sits outside the workspace layout and has none of its own.
 */
import { describe, it, expect, vi } from "vitest";
import { RouterContextProvider } from "react-router";

const ok = (data: unknown) => Promise.resolve({ ok: true, json: async () => ({ data }) });
const SESSION = {
    branding: { tenantSlug: "co", defaultTimezone: "Europe/Paris", defaultLocale: "fr-FR", dateFormat: "eu", timeFormat: "24h" },
    user: { sessionMarker: "m-1", role: "inspector", timezone: null, locale: "fr-CA", dateFormat: null, timeFormat: null, name: "Pat", email: "p@x.test", capabilities: {} },
    videoProvider: "r2",
    collabEditing: true,
};
const calls: string[] = [];

vi.mock("~/lib/session.server", () => ({ requireToken: vi.fn().mockResolvedValue("tok") }));
vi.mock("~/lib/api-client.server", () => ({
    createApi: () => ({
        inspections: {
            ":id": {
                $get: () => ok({ inspection: { id: "i1", status: "draft", propertyType: "single_family" } }),
                results: { $get: () => ok({ results: {}, resultId: "r1" }) },
                "report-data": { $get: () => ok({ sections: [], ratingLevels: [] }) },
            },
        },
        tags: { index: { $get: () => ok([]) } },
        sessionContext: { context: { $get: () => { calls.push("session"); return ok(SESSION); } } },
        defectCategories: { "defect-categories": { $get: () => ok([]) } },
    }),
}));

import { loader } from "~/routes/inspection-edit/loader.server";
import { routeArgs } from "../../../tests/helpers/route-args";

const run = () => loader(routeArgs(new Request("http://localhost/inspections/i1/edit"), {
    params: { id: "i1" },
    context: new RouterContextProvider() as unknown as Parameters<typeof loader>[0]["context"],
}) as never) as Promise<Record<string, unknown>>;

describe("editor loader viewer", () => {
    it("carries the viewer's display values and marker, from the one session-context call, and not the name or email", async () => {
        const out = await run();
        expect(calls).toEqual(["session"]);
        expect(out.viewer).toEqual({
            user: { sessionMarker: "m-1", role: "inspector", timezone: null, locale: "fr-CA", dateFormat: null, timeFormat: null },
            branding: { defaultTimezone: "Europe/Paris", defaultLocale: "fr-FR", dateFormat: "eu", timeFormat: "24h" },
        });
        expect(JSON.stringify(out.viewer)).not.toContain("p@x.test");
    });
});
