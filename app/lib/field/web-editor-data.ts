import type { useLoaderData } from "react-router";
import type { EditorData } from "@core/field-ui/data-source";
import type { EditorInspection } from "@core/field-ui/data-source-types";
import type { loader } from "~/routes/inspection-edit/loader.server";

/**
 * What the inspection-edit route's `useLoaderData` hands back (the loader's return value after
 * React Router's serialisation typing). Derived, never restated: a change to the loader's return
 * shape changes this type, and `editorDataFromLoader` below stops compiling until it is reconciled.
 */
export type EditorLoaderData = ReturnType<typeof useLoaderData<typeof loader>>;

/**
 * Convert the loader's payload to the field editor's `EditorData`.
 *
 * Every field is assigned by name, so a field the loader drops or renames fails to compile here
 * instead of arriving as `undefined`. The loader types three fields more loosely than `EditorData`:
 * `inspection` is checked at runtime, and `schema` and `templateSnapshot` cross the single cast
 * boundary below, each with its reason.
 */
export function editorDataFromLoader(d: EditorLoaderData): EditorData {
    const id = d.inspection.id;
    if (typeof id !== "string" || id === "") throw new Error("The editor payload carries no inspection id.");
    const inspection: EditorInspection = { ...d.inspection, id };
    return {
        inspection,
        // CAST BOUNDARY 1/2. The loader types `schema.sections` as `Record<string, unknown>[]` because the
        // report-data overlay builds them from untyped API JSON. The contract's `TemplateSchema` is the
        // shape the editor reads off that same JSON (the route casts it identically, `as unknown as
        // InspectionSchema`). Re-validating a whole template tree here would duplicate the server's job.
        schema: d.schema as unknown as EditorData["schema"],
        results: d.results,
        ratingLevels: d.ratingLevels,
        tagLibrary: d.tagLibrary,
        defectCategories: d.defectCategories,
        units: d.units,
        unitProgress: d.unitProgress,
        unitInspectionMode: d.unitInspectionMode,
        // CAST BOUNDARY 2/2. The loader produces this with `JSON.parse(...) as { schemaVersion: 2;
        // sections: unknown[] }`: the cast already happens server-side, and `unknown[]` is only its
        // honest spelling. The sections are structural-edit input the server validates on write.
        templateSnapshot: d.templateSnapshot as unknown as EditorData["templateSnapshot"],
        revisionStatus: d.revisionStatus,
        statutoryDetails: d.statutoryDetails,
        statutoryCoverage: d.statutoryCoverage,
        compliance: d.compliance,
        pcaNarrative: d.pcaNarrative,
        relianceText: d.relianceText,
        commercialPresets: d.commercialPresets,
        nextPublishIsAmendment: d.nextPublishIsAmendment,
        outboundCoolingWindow: d.outboundCoolingWindow,
        resultId: d.resultId,
        initialLayout: d.initialLayout,
    };
}
