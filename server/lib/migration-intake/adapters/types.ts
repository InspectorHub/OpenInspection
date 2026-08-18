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
    convert(input: unknown, options: TOptions): BundleResult;
}

/** The accounting for an entity kind this adapter emits nothing of. */
export function emptyEntityCounts(): EntityCounts {
    return { readFromSource: 0, emitted: 0, dropped: [] };
}
