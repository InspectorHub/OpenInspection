import { PCA_NARRATIVE_SEED } from "@core/field-ui/shared/pca-narrative";
import { RELIANCE_TEMPLATES } from "@core/field-ui/shared/pca-reliance-text";
import type { EditorLoaderData } from "./web-editor-data";

/**
 * A complete inspection-edit loader payload. It is annotated with the loader's own return type
 * and lists every field, so a field the loader adds, drops or retypes stops this file compiling.
 */
export function loaderPayload(over: Partial<EditorLoaderData> = {}): EditorLoaderData {
    const base: EditorLoaderData = {
        inspection: { id: "insp-1", propertyAddress: "1 Main St", status: "draft" },
        schema: { sections: [] },
        results: {},
        resultId: "res-1",
        ratingLevels: [],
        tagLibrary: [],
        tenantSlug: "acme",
        streamCustomerSubdomain: "",
        videoProvider: "r2",
        collabEditing: false,
        outboundCoolingWindow: null,
        templateSnapshot: { schemaVersion: 2, sections: [] },
        revisionStatus: null,
        pcaNarrative: { ...PCA_NARRATIVE_SEED },
        defectCategories: [],
        units: [],
        unitProgress: { units: [], commonRated: 0, total: 0 },
        unitInspectionMode: "tagged",
        compliance: { reportSignoffs: [], psq: null, documentReview: [], conformance: { standard: "E2018-24", conforms: false } },
        relianceText: { ...RELIANCE_TEMPLATES },
        commercialPresets: {},
        statutoryDetails: null,
        statutoryCoverage: null,
        nextPublishIsAmendment: false,
    };
    return { ...base, ...over };
}
