// @vitest-environment node
/**
 * The editor loader asks only for data the inspection can have.
 *
 * Six reads are common to every inspection. Units and unit progress exist for
 * multi-unit and commercial jobs, compliance artifacts only for a full PCA
 * report, and the statutory-form answers only when the template declares a
 * statutory form (the endpoints 404 otherwise, which meant "nothing here").
 * A residential inspection used to pay for all five anyway.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { RouterContextProvider } from "react-router";

const seam = vi.hoisted(() => ({
    calls: [] as string[],
    inspection: {} as Record<string, unknown>,
    hangReport: false,
}));

const ok = (data: unknown) => (data instanceof Promise ? data : Promise.resolve({ ok: true, json: async () => ({ data }) }));
const rec = (name: string, data: () => unknown) => (..._a: unknown[]) => {
    seam.calls.push(name);
    return ok(data());
};

vi.mock("~/lib/session.server", () => ({ requireToken: vi.fn().mockResolvedValue("tok") }));
vi.mock("~/lib/api-client.server", () => ({
    createApi: () => ({
        inspections: {
            ":id": {
                $get: rec("inspection", () => ({ inspection: seam.inspection })),
                results: { $get: rec("results", () => ({ results: {}, resultId: "r1" })) },
                "report-data": { $get: rec("report-data", () => (seam.hangReport ? new Promise(() => {}) as never : { sections: [], ratingLevels: [] })) },
                units: { $get: rec("units", () => ({ units: [{ id: "u1", name: "Unit 1", kind: "unit", type: "unit", parentUnitId: null, sortOrder: 0 }] })) },
                "unit-progress": { $get: rec("unit-progress", () => ({ units: [{ unitId: "u1", rated: 1, total: 2 }], commonRated: 0, total: 2 })) },
                compliance: { $get: rec("compliance", () => ({ reportSignoffs: [{ id: "s" }], psq: null, documentReview: [], conformance: { standard: "E2018-24", conforms: true } })) },
                "statutory-details": { $get: rec("statutory-details", () => ({ ownerName: "Pat", inspectorSignatureDate: null, employeePrintedName: null, ownerEmail: null, ownerMailingAddress: null, ownerHomePhone: null, ownerWorkPhone: null, ownerCellPhone: null })) },
                "statutory-form": { coverage: { $get: rec("statutory-coverage", () => ({ formId: "f", formTitle: "F", revision: null, requiredTotal: 3, missing: [] })) } },
            },
        },
        tags: { index: { $get: rec("tags", () => []) } },
        sessionContext: { context: { $get: rec("session", () => ({ branding: { tenantSlug: "co" }, videoProvider: "r2", collabEditing: true })) } },
        defectCategories: { "defect-categories": { $get: rec("defect-categories", () => []) } },
    }),
}));

import { loader } from "~/routes/inspection-edit/loader.server";
import { routeArgs } from "../../../tests/helpers/route-args";

const CONTEXT = new RouterContextProvider() as unknown as Parameters<typeof loader>[0]["context"];
const run = () => loader(routeArgs(new Request("http://localhost/inspections/i1/edit"), { params: { id: "i1" }, context: CONTEXT }) as never);
const COMMON = ["inspection", "results", "report-data", "tags", "session", "defect-categories"];
type Out = {
    units: unknown[]; unitProgress: { total: number }; compliance: { reportSignoffs: unknown[] };
    statutoryDetails: unknown; statutoryCoverage: unknown;
};

beforeEach(() => {
    seam.calls.length = 0;
    seam.hangReport = false;
    seam.inspection = { id: "i1", status: "draft", propertyAddress: "1 Main", date: "2026-10-18T10:00:00Z", templateSnapshot: { schemaVersion: 2, sections: [] } };
});

describe("editor loader reads", () => {
    it("a single-family inspection makes only the six common reads and gets the empty defaults", async () => {
        seam.inspection.propertyType = "single_family";
        const out = await run() as unknown as Out;
        expect(seam.calls.sort()).toEqual([...COMMON].sort());
        expect(out.units).toEqual([]);
        expect(out.unitProgress).toEqual({ units: [], commonRated: 0, total: 0 });
        expect(out.compliance.reportSignoffs).toEqual([]);
        expect(out.statutoryDetails).toBeNull();
        expect(out.statutoryCoverage).toBeNull();
    });

    it("an unclassified (legacy) inspection still reads units, as before", async () => {
        const out = await run() as unknown as Out;
        expect(seam.calls).toEqual(expect.arrayContaining(["units", "unit-progress"]));
        expect(seam.calls).not.toContain("compliance");
        expect(out.units).toHaveLength(1);
    });

    it("a multi-unit inspection reads units and unit progress, not compliance", async () => {
        seam.inspection.propertyType = "multi_unit";
        await run();
        expect(seam.calls.sort()).toEqual([...COMMON, "units", "unit-progress"].sort());
    });

    it("a per-unit inspection reads units even when it is classified single-family", async () => {
        seam.inspection.propertyType = "single_family";
        seam.inspection.unitInspectionMode = "per_unit";
        await run();
        expect(seam.calls).toEqual(expect.arrayContaining(["units", "unit-progress"]));
    });

    it("a light commercial inspection reads units but not the full-PCA compliance artifacts", async () => {
        seam.inspection.propertyType = "commercial";
        seam.inspection.reportTier = "light_commercial";
        await run();
        expect(seam.calls).toContain("units");
        expect(seam.calls).not.toContain("compliance");
    });

    it("a full PCA inspection also reads compliance", async () => {
        seam.inspection.propertyType = "commercial";
        seam.inspection.reportTier = "full_pca";
        const out = await run() as unknown as Out;
        expect(seam.calls.sort()).toEqual([...COMMON, "units", "unit-progress", "compliance"].sort());
        expect(out.compliance.reportSignoffs).toHaveLength(1);
    });

    it("a template that declares a statutory form reads the statutory answers", async () => {
        seam.inspection.propertyType = "single_family";
        seam.inspection.templateSnapshot = { schemaVersion: 2, sections: [], statutoryForm: { formId: "f" } };
        const out = await run() as unknown as Out;
        expect(seam.calls.sort()).toEqual([...COMMON, "statutory-details", "statutory-coverage"].sort());
        expect(out.statutoryDetails).toMatchObject({ ownerName: "Pat" });
        expect(out.statutoryCoverage).toMatchObject({ requiredTotal: 3 });
    });

    it("an unreadable inspection still answers with the common reads only and does not throw", async () => {
        seam.inspection = {};
        await expect(run()).resolves.toBeTruthy();
        expect(seam.calls.length).toBeLessThanOrEqual(COMMON.length + 2);
    });

    it("starts the optional reads as soon as the inspection row arrives, without waiting for the slowest common read", async () => {
        seam.inspection.propertyType = "commercial";
        seam.inspection.reportTier = "full_pca";
        seam.hangReport = true;
        void run();
        await new Promise((r) => setTimeout(r, 30));
        expect(seam.calls).toEqual(expect.arrayContaining(["units", "unit-progress", "compliance"]));
    });
});
