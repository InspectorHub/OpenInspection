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
 * So nothing here catches and continues. In particular the check that the
 * bytes are the ones the map was authored against is NOT wrapped -- it is the
 * only voice on this path that can say "these are not the bytes we published".
 * It runs as the renderer's first act rather than as a separate step here; the
 * note at step 4 says why, and the spec beside this file holds the guarantee
 * against THIS function so that moving it cannot quietly lose it.
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
import {
    versionForInspection,
    withdrawnVersionsFor,
    type StatutoryFormVersion,
} from '../../lib/statutory/form-registry';
import { PUBLISHED_FORM_VERSIONS, fieldMapFor as publishedFieldMapFor } from '../../lib/statutory/forms';
import type { FieldMap } from '../../lib/statutory/field-map';
import { withdrawalRefusal } from '../../lib/statutory/withdrawal-copy';
import { renderStatutoryForm } from '../../lib/statutory/render';
import { utcMidnightOf } from '../../lib/statutory/inspection-date';
import {
    collectStatutoryValues,
    type StatutoryGroupInstances,
    type StatutoryInspectionFacts,
    type StatutoryItemResult,
} from '../../lib/statutory/values';
import type { SignatureImage } from '../../lib/statutory/render-signature';
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
    /**
     * Repeated-block instances the page has no slot to print, read from
     * `statutory_form_entries`. Absent is the ordinary case and means the same
     * as none: a house with two panels overflows nothing.
     *
     * Printed slots do NOT arrive here -- they are ordinary template items and
     * reach the form as bindings, which is why this defaults to empty rather
     * than being required.
     */
    instances?: StatutoryGroupInstances;
    /**
     * The signatures the declaration's `from: 'signature'` bindings resolve to,
     * keyed by our field name. Resolved by the caller, which is the layer that
     * can read the inspector's stored mark; empty is the ordinary case, and a
     * form that REQUIRES one then refuses by name in `renderStatutoryForm`
     * rather than producing an unsigned document that looks signed.
     *
     * A separate channel from `facts` and `results` for the reason
     * `StatutoryValueSource` gives: `collectStatutoryValues` is declared to
     * carry no personal data of this class, and it emits no key for a signature.
     */
    signatures?: ReadonlyMap<string, SignatureImage>;
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

/**
 * The refusal to write when the reason nothing was selected is a WITHDRAWAL,
 * or null when it is not.
 *
 * Returning null rather than a fallback sentence keeps the two absences apart
 * at the call site: this function answers only the question it can answer, and
 * "this deployment publishes nothing for that date" stays the caller's own
 * sentence rather than becoming a default this one quietly emits.
 */
function withdrawnRefusal(
    formId: string,
    inspectionDate: string,
    inspectedAt: number,
    versions: readonly StatutoryFormVersion[],
): string | null {
    const withdrawn = withdrawnVersionsFor(formId, inspectedAt, versions)[0];
    // Non-null by the filter inside `withdrawnVersionsFor`; narrowed rather than
    // asserted, because an assertion here would survive that filter changing.
    if (withdrawn?.withdrawn == null) return null;
    return withdrawalRefusal({
        formId,
        version: withdrawn.version,
        reason: withdrawn.withdrawn.reason,
        at: withdrawn.withdrawn.at,
        // Nothing was selectable -- that is why this path is running -- so there
        // is no replacement to name, and inventing one would be a guess.
        replacementVersion: null,
        inspectionDate,
    });
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
        // Two different absences arrive as the same `null`, and a refusal that
        // reads them as one tells an operator to look for a revision that is
        // sitting right there in the catalogue, withdrawn. So the withdrawn ones
        // are asked for by name, and the reason is quoted -- it decides whether
        // the reader is waiting on a software update or has to go and get the
        // form the authority now requires.
        fail(withdrawnRefusal(input.formId, input.inspectionDate, inspectedAt, versions)
            ?? `no published revision of "${input.formId}" covers ${input.inspectionDate}. `
            + 'The nearest revision to a date it does not cover is a different document.');
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

    // 4. Are these the bytes the map was authored against? The check still
    //    happens and is still unwrapped -- it moved rather than went away.
    //    `renderStatutoryForm` performs it as its first act and cannot be asked
    //    not to, so the call that stood here ran `validateAgainstPdf` with the
    //    same map and the same bytes a few lines before the renderer ran it
    //    again: a second sha256 over the whole file and a second full parse of
    //    it, for a second copy of an answer that had not changed.
    //
    //    ⚠️ The guarantee is not left to this comment. The spec beside this
    //    file asserts that produceStatutoryForm REJECTS when the stored bytes
    //    do not hash to the published sourceHash, and it asserts it through
    //    this function rather than through the validator, so it fails if the
    //    renderer ever stops checking.

    const values = collectStatutoryValues(
        input.declaration, input.snapshot, input.results, input.facts, input.instances ?? {},
    );
    const rendered = await renderStatutoryForm(bytes, map, values, input.signatures);
    return { version, bytes: rendered };
}
