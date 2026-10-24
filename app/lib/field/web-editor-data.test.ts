import { describe, expect, it } from "vitest";
import { editorDataFromLoader } from "./web-editor-data";
import { loaderPayload } from "./web-editor-data.fixtures";

/**
 * The loader-shape guard is the typed fixture (`web-editor-data.fixtures.ts`): it is annotated with
 * the loader's return type, so a loader change breaks compilation of this test file under
 * `type-check:app`. The cases below pin the runtime behaviour.
 */
describe("editorDataFromLoader", () => {
    it("carries every EditorData field across by name", () => {
        const data = editorDataFromLoader(loaderPayload({ resultId: null, nextPublishIsAmendment: true, unitInspectionMode: "per_unit" }));
        expect(Object.keys(data).sort()).toEqual(
            [
                "commercialPresets", "compliance", "defectCategories", "initialLayout", "inspection", "nextPublishIsAmendment",
                "outboundCoolingWindow", "pcaNarrative", "ratingLevels", "relianceText", "resultId", "results",
                "revisionStatus", "schema", "statutoryCoverage", "statutoryDetails", "tagLibrary", "templateSnapshot",
                "unitInspectionMode", "unitProgress", "units",
            ].sort(),
        );
        expect(data.resultId).toBeNull();
        expect(data.nextPublishIsAmendment).toBe(true);
        expect(data.unitInspectionMode).toBe("per_unit");
    });

    it("carries the remembered layout band the loader read", () => {
        expect(editorDataFromLoader(loaderPayload({ initialLayout: "phone" })).initialLayout).toBe("phone");
        expect(editorDataFromLoader(loaderPayload()).initialLayout).toBe("desktop");
    });

    it("keeps the inspection row and its id", () => {
        const data = editorDataFromLoader(loaderPayload({ inspection: { id: "i9", propertyType: "commercial", extra: 1 } }));
        expect(data.inspection).toEqual({ id: "i9", propertyType: "commercial", extra: 1 });
    });

    it("refuses a payload without an inspection id, loudly", () => {
        expect(() => editorDataFromLoader(loaderPayload({ inspection: {} }))).toThrow(/inspection id/);
        expect(() => editorDataFromLoader(loaderPayload({ inspection: { id: 7 } }))).toThrow(/inspection id/);
    });
});
