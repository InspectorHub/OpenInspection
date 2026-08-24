/**
 * Which product an export came from, as the operator declares it.
 *
 * This module exists because a rule was deleted. The intent used to decide the
 * vendor — `templates.create` meant Spectora, always — so a Home Inspector Pro
 * template was answered with "nothing could read that", which is true and
 * useless. With a declaration in hand the question changes from "can I read
 * this" to "is this what you said it was", and that has a specific answer.
 *
 * Pure: no React, no message catalogue, no server import that pulls a reader
 * into the browser bundle. The sentences are the picker's, keyed by vendor;
 * what lives here is only which options an entry point offers and whether each
 * one is read on this deployment or by a person.
 *
 * ⚠️ `readHere` is a claim about the ADAPTER REGISTRY, restated here rather
 * than imported from it — importing `adapters/registry` would drag a zip
 * reader, an XLSX reader and a Java-serialisation reader into every page that
 * renders an upload form. `import-sources.test.ts` asserts the two agree, in
 * both directions, so the restatement cannot drift into an advertisement for a
 * reader that no longer exists.
 */
import type { VendorId } from '../../server/lib/migration-intake/bundle';
import type { ImportEntryIntent } from './import-entry-points';

/** One product whose export an entry point will take. */
export interface ImportSourceOption {
    vendor: VendorId;
    /**
     * Whether an adapter on this deployment reads this vendor's export.
     *
     * False is not "unsupported" and is not an error: it is the fact that
     * decides which of two sentences the picker prints, and the second of them
     * — a person converts the file by hand — is a real path with a real
     * timescale that the operator is entitled to know BEFORE handing the file
     * over rather than after.
     */
    readHere: boolean;
    /**
     * Whether this source's file is read as TEXT (a table) rather than as a
     * container.
     *
     * Decides whether the browser may flatten a chosen workbook down to one
     * sheet of CSV before uploading it. A container vendor's `.xlsx` is a
     * package the reader opens itself — a Spectora template export carries far
     * more than a grid of cells — and one sheet of it is not that file. So the
     * question conversion is keyed on is never "is this file an .xlsx"; it is
     * "did the operator declare a source that is read as a table".
     *
     * ⚠️ A claim about the READER, restated here rather than imported, for the
     * reason the module header gives. `import-sources.test.ts` asserts it
     * against `CONTAINER_VENDORS` in both directions.
     */
    tabular: boolean;
}

/**
 * The products whose TEMPLATE exports this entry takes.
 *
 * Order is the order they are offered in. HomeGauge is on the list precisely
 * because nothing here reads it: leaving it off would put the operator in
 * front of three options none of which is his product, and the honest answer —
 * a person converts it, and here is how long that takes — is one he can only
 * be given if he can say what he has.
 */
const TEMPLATE_SOURCES: readonly ImportSourceOption[] = [
    { vendor: 'spectora', readHere: true, tabular: false },
    { vendor: 'home_inspector_pro', readHere: true, tabular: false },
    { vendor: 'homegauge', readHere: false, tabular: false },
];

/**
 * The one source a list of people can arrive as.
 *
 * A contacts or team file is a table whoever exported it, and no product's
 * name changes how it is read — which is why this list has one entry rather
 * than one per vendor with the same reader behind each.
 */
const TABULAR_SOURCES: readonly ImportSourceOption[] = [
    { vendor: 'csv_generic', readHere: true, tabular: true },
];

/**
 * The sources this entry point offers, in the order they are offered.
 *
 * Empty for `assisted.full`, and that is the whole meaning of that entry: it
 * exists for a file whose owner could not name the product it came from, so
 * asking him to name one is the guess every other entry point is built to
 * avoid, moved one question earlier.
 */
export function importSourcesFor(intent: ImportEntryIntent): readonly ImportSourceOption[] {
    switch (intent) {
        case 'templates.create':
            return TEMPLATE_SOURCES;
        case 'contacts.import':
        case 'members.invite':
            return TABULAR_SOURCES;
        case 'assisted.full':
            return [];
    }
}

/**
 * The source already settled by the entry point, or null when there is a
 * question to ask.
 *
 * Answered ONLY where the entry offers exactly one option, because a radio
 * group of one is not a question — it is a fact, and making somebody click it
 * teaches them that the control does not matter. Answered anywhere else it
 * would BE the deleted rule: `templates.create` quietly meaning Spectora, with
 * a picker drawn over the top of it.
 */
export function defaultImportSourceFor(intent: ImportEntryIntent): VendorId | null {
    const sources = importSourcesFor(intent);
    return sources.length === 1 ? sources[0].vendor : null;
}

/**
 * Whether the declared source at this entry point is read as a table.
 *
 * Asked of the ENTRY POINT and not of the vendor name alone: a field carrying
 * `spectora` on the contacts entry is not a declaration that entry accepts, so
 * it is certainly not a licence to rewrite the file. An unoffered vendor, and a
 * null one, are both false — which is what keeps the raw-workbook escape hatch
 * reachable, because `assisted.full` offers no source at all and therefore
 * never converts.
 */
export function sourceIsTabular(intent: ImportEntryIntent, vendor: string | null): boolean {
    if (!vendor) return false;
    return importSourcesFor(intent).find((s) => s.vendor === vendor)?.tabular ?? false;
}

/** Whether a value is a source this entry point offers. Narrowed, never cast. */
export function asImportSource(
    intent: ImportEntryIntent,
    value: unknown,
): VendorId | null {
    return importSourcesFor(intent).find((s) => s.vendor === value)?.vendor ?? null;
}
