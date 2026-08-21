import type { EntityCounts, MigrationBundleV1, VendorId } from '../bundle';

/**
 * What an adapter returns.
 *
 * A failure is a value, not an exception. An adapter's failure mode is "this
 * file is not what I know how to read", which is the operator's problem to
 * fix; throwing would turn it into an unhandled server condition and lose the
 * sentence that would have told them what to change.
 */
export type BundleResult =
    | { ok: true; bundle: MigrationBundleV1 }
    | { ok: false; error: { code: string; message: string } };

/**
 * What a TABULAR source looks like from the outside: its column headers and a
 * few rows to show the operator what a column actually contains.
 *
 * Sampled rather than complete — the mapping step needs enough to recognise a
 * column, not the file.
 */
export interface AdapterInspection {
    columns: string[];
    sampleRows: Record<string, string>[];
}

/**
 * One vendor, one file, one fixture.
 *
 * `convert` is pure: same input, same output, no database, no network, no
 * clock-dependent identity. Everything it needs that is not in the file comes
 * in through `options`.
 */
export interface MigrationAdapter<TOptions> {
    readonly name: string;
    readonly version: string;
    readonly vendor: VendorId;
    /**
     * Report the columns of a tabular source so they can be mapped to fields.
     * Receives the uploaded file as text.
     *
     * OPTIONAL, and its ABSENCE carries meaning: an adapter that does not
     * implement this reads a format with no columns to point at, so the wizard
     * has no mapping question to ask and skips that step entirely. The skip is
     * therefore a fact about the adapter's shape rather than a special case
     * somebody remembered to write in the interface.
     *
     * Returns null when the input has no readable header at all.
     */
    inspect?(input: unknown): AdapterInspection | null;
    convert(input: unknown, options: TOptions): BundleResult;
}

/** The accounting for an entity kind this adapter emits nothing of. */
export function emptyEntityCounts(): EntityCounts {
    return { readFromSource: 0, emitted: 0, dropped: [] };
}
