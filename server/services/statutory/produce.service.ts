/**
 * Produce one statutory form: choose the revision, fetch the published bytes,
 * collect the values, render.
 *
 * Four steps, and each one refuses rather than degrading. That is the whole
 * character of this file, and the reason is the same every time: every failure
 * mode here produces a document that looks entirely correct.
 *
 *   - A revision that does not cover the inspection date is still a real
 *     official form. Rendering "the nearest one" delivers the wrong document
 *     with nothing to distinguish it.
 *   - Bytes that are not the ones the map was authored against still render.
 *     The values simply land in boxes nobody measured.
 *   - A missing object degrades, if you let it, into a blank form -- and a
 *     blank looks exactly like an answer nobody had.
 *
 * So nothing here catches and continues. In particular `validateAgainstPdf` is
 * NOT wrapped: it is the only voice on this path that can say "these are not
 * the bytes we published".
 *
 * -- WHERE THE REVISIONS COME FROM -------------------------------------------
 * The published catalogue in code (`PUBLISHED_FORM_VERSIONS`), not the
 * `statutory_form_versions` table. Publishing a revision is a person's decision
 * that needs a field map authored against those exact bytes; a row is data that
 * can arrive without one. Verified before writing this: nothing in `server/`
 * reads or writes that table at runtime.
 *
 * -- NOTHING IS WRITTEN BACK, AND THE COST WAS MEASURED ----------------------
 * The rendered PDF is returned, never stored. Storing it would create a new
 * artifact class needing its own erasure rule, retention period and
 * classification, and the form is cheap to rebuild from inputs that are all
 * already durable.
 *
 * "Cheap" is measured, not assumed. In real workerd via vitest-pool-workers
 * (`tests/workers/statutory-render-cost.spec.ts`, 2026-08-27): ten renders of a
 * flat overlay-mapped form cost 24ms in-isolate, 2.4ms each; the first render
 * of a cold isolate reads 7ms. Node is not comparable here and was not used --
 * it over-reports by a workload-dependent factor, so a Node figure cannot be
 * divided down into this one.
 *
 * If a real six-page authority PDF with a large AcroForm moves that by an order
 * of magnitude, the answer is still NOT a cache added here quietly: it is a
 * separate plan for a stored artifact and the four governance entries it needs.
 */
import { versionForInspection, type StatutoryFormVersion } from '../../lib/statutory/form-registry';
import { PUBLISHED_FORM_VERSIONS, fieldMapFor as publishedFieldMapFor } from '../../lib/statutory/forms';
import { validateAgainstPdf, type FieldMap } from '../../lib/statutory/field-map';
import { renderStatutoryForm } from '../../lib/statutory/render';
import { utcMidnightOf } from '../../lib/statutory/inspection-date';
import {
    collectStatutoryValues,
    type StatutoryInspectionFacts,
    type StatutoryItemResult,
} from '../../lib/statutory/values';
import { r2Keys } from '../../lib/r2-keys';
import type { StatutoryFormDeclaration, TemplateSchemaV2 } from '../../types/template-schema';

export interface ProduceStatutoryFormInput {
    /** The form the template declares. */
    formId: string;
    /** `inspections.date` -- a calendar day, never a timestamp. */
    inspectionDate: string;
    declaration: StatutoryFormDeclaration;
    /** The snapshot the inspection ran against, not the current template row. */
    snapshot: TemplateSchemaV2;
    results: Record<string, StatutoryItemResult>;
    facts: StatutoryInspectionFacts;
    bucket: R2Bucket;
    /**
     * Seams, defaulted to the published catalogue. They exist because the
     * catalogue ships EMPTY by declaration, so a test that could not supply its
     * own revisions could only ever assert that nothing is publishable.
     */
    versions?: readonly StatutoryFormVersion[];
    fieldMapFor?: (formId: string, version: string) => FieldMap | null;
}

export interface ProducedStatutoryForm {
    /** The revision actually used -- returned so a caller can record it beside
     *  the delivered file rather than re-deriving it later and possibly
     *  differently. */
    version: StatutoryFormVersion;
    bytes: Uint8Array;
}

function fail(reason: string): never {
    throw new Error(`statutory produce: ${reason}`);
}

export async function produceStatutoryForm(
    input: ProduceStatutoryFormInput,
): Promise<ProducedStatutoryForm> {
    const versions = input.versions ?? PUBLISHED_FORM_VERSIONS;
    const lookupMap = input.fieldMapFor ?? publishedFieldMapFor;

    // 1. Which revision. The inspection date decides, in UTC -- see
    //    inspection-date.ts for why not the workspace timezone.
    const inspectedAt = utcMidnightOf(input.inspectionDate);
    const version = versionForInspection(input.formId, inspectedAt, versions);
    if (!version) {
        fail(
            `no published revision of "${input.formId}" covers ${input.inspectionDate}. `
            + 'The nearest revision to a date it does not cover is a different document.',
        );
    }

    // 2. Its map. A revision with no map cannot be rendered at all: the map is
    //    what says where on the page anything goes.
    const map = lookupMap(input.formId, version.version);
    if (!map) {
        fail(`no field map is published for "${input.formId}" ${version.version}`);
    }

    // 3. The authority's bytes.
    const key = r2Keys.statutoryFormSource(input.formId, version.version);
    const object = await input.bucket.get(key);
    if (!object) {
        fail(
            `the official PDF for "${input.formId}" ${version.version} is not stored at ${key}. `
            + 'Refusing rather than rendering a blank form.',
        );
    }
    const bytes = new Uint8Array(await object.arrayBuffer());

    // 4. Are these the bytes the map was authored against? Deliberately not
    //    wrapped -- this throw is the only thing standing between a tampered or
    //    swapped object and values written into boxes nobody measured.
    await validateAgainstPdf(map, bytes);

    const values = collectStatutoryValues(input.declaration, input.snapshot, input.results, input.facts);
    const rendered = await renderStatutoryForm(bytes, map, values);
    return { version, bytes: rendered };
}
