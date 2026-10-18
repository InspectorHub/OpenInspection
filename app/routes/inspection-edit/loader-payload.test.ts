// @vitest-environment node
/**
 * What the editor loader puts into the page.
 *
 * Everything the loader returns is serialised into the HTML and the .data
 * response, so each field is paid for on every editor load. Two fields were
 * dead weight: the session token (nothing reads it, and it put the session JWT
 * into the page source) and the template snapshot carried a second time inside
 * the inspection row (the editor reads the snapshot from its own top-level
 * field).
 */
import { describe, it, expect, vi } from "vitest";
import { RouterContextProvider } from "react-router";

const SNAPSHOT = { schemaVersion: 2, sections: [{ id: "s1", title: "Roof", items: [{ id: "i1", label: "Cover", type: "rich" }] }] };
const ok = (data: unknown) => Promise.resolve({ ok: true, json: async () => ({ data }) });

vi.mock("~/lib/session.server", () => ({ requireToken: vi.fn().mockResolvedValue("SECRET-SESSION-TOKEN") }));
vi.mock("~/lib/api-client.server", () => ({
    createApi: () => ({
        inspections: {
            ":id": {
                $get: () => ok({ inspection: { id: "i1", status: "draft", propertyType: "single_family", propertyAddress: "1 Main", date: "2026-10-18T10:00:00Z", templateSnapshot: SNAPSHOT } }),
                results: { $get: () => ok({ results: {}, resultId: "r1" }) },
                "report-data": { $get: () => ok({ sections: SNAPSHOT.sections, ratingLevels: [] }) },
            },
        },
        tags: { index: { $get: () => ok([]) } },
        sessionContext: { context: { $get: () => ok({ branding: { tenantSlug: "co" }, videoProvider: "r2", collabEditing: true }) } },
        defectCategories: { "defect-categories": { $get: () => ok([]) } },
    }),
}));

import { loader } from "~/routes/inspection-edit/loader.server";
import { routeArgs } from "../../../tests/helpers/route-args";

const run = () => loader(routeArgs(new Request("http://localhost/inspections/i1/edit"), {
    params: { id: "i1" },
    context: new RouterContextProvider() as unknown as Parameters<typeof loader>[0]["context"],
}) as never) as Promise<Record<string, unknown>>;

describe("editor loader payload", () => {
    it("does not carry the session token into the page", async () => {
        const out = await run();
        expect(out).not.toHaveProperty("token");
        expect(JSON.stringify(out)).not.toContain("SECRET-SESSION-TOKEN");
    });

    it("carries the template snapshot once, as its own field, not again inside the inspection row", async () => {
        const out = await run();
        expect(out.templateSnapshot).toEqual(SNAPSHOT);
        expect(out.inspection).not.toHaveProperty("templateSnapshot");
        expect(out.inspection).toMatchObject({ id: "i1", propertyType: "single_family", propertyAddress: "1 Main" });
    });

    it("keeps every other field the editor reads", async () => {
        const out = await run();
        for (const key of ["schema", "results", "resultId", "ratingLevels", "tagLibrary", "tenantSlug", "videoProvider", "collabEditing", "defectCategories", "units", "unitProgress", "unitInspectionMode", "compliance", "relianceText", "commercialPresets", "statutoryDetails", "statutoryCoverage", "nextPublishIsAmendment", "outboundCoolingWindow", "revisionStatus", "pcaNarrative"]) {
            expect(out, key).toHaveProperty(key);
        }
    });
});
