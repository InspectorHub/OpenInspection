/**
 * Size limits for importing an offline package, and the budget they protect.
 *
 * One import is ONE Worker invocation, and a Worker invocation has two ceilings
 * that a package can run into long before it runs out of memory:
 *
 *  - CPU time per invocation (10 ms on the Workers Free plan, far more on Paid);
 *  - subrequests per invocation. Every call to a binding counts: each D1 query,
 *    KV operation, R2 operation, Images call and Durable Object fetch. Free
 *    allows 1000 per invocation, Paid allows far more.
 *
 * The defaults below are sized so that the LARGEST package they admit still fits
 * the Free plan's 1000-subrequest ceiling with room to spare. An operator on a
 * paid plan, or on infrastructure with no such ceiling, raises them with the
 * `NATIVE_IMPORT_*` variables; nothing else needs to change. A package over the
 * limit is refused up front with 422 PACKAGE_TOO_LARGE, before anything is
 * written, and the response names the limits so a client can split the package.
 * Imports are idempotent at every step, so a split package imports exactly like
 * a whole one: put each inspection's results, photos and queued writes in the
 * same part, and send the part that carries an inspection's create first.
 *
 * Budget, measured by counting binding calls in `offline-import-budget.spec.ts`
 * (the figures are subrequests, from a cold start):
 *
 *   fixed overhead (auth, tenant lookup, audit, first requests)   ~70
 *   + per inspection (create or authorize, Durable Object import) ~22
 *   + per queued write (it is replayed as an ordinary request,
 *     so it pays the whole middleware chain: ~14 D1 + ~6 KV)      ~20
 *   + per photo (R2 put, pending-photo resolution)                ~3
 *
 * Queued writes dominate. Default maximum: 70 + 8*22 + 20*20 + 50*3 = 796
 * estimated subrequests, and the spec measures the largest default package
 * under 800 (787 measured). That leaves about a fifth of the Free ceiling free for what the
 * estimate averages away (a queued write that touches more rows costs more).
 *
 * Bytes are bounded separately and for a different reason. The package is held
 * in memory while its entries are read, so the byte limits protect the Worker's
 * memory, not its subrequest budget. The compressed and decompressed limits
 * cannot be raised past the ceilings in `IMPORT_LIMIT_CEILINGS`, which are what
 * the memory-safe reader was designed around.
 *
 * Reading the variables never throws. A missing, blank, non-numeric or
 * non-integer value falls back to the default; a number outside the allowed
 * range is clamped into it. A misconfiguration therefore can never switch a
 * limit off.
 */

import { AppError, ErrorCode } from '../errors';

const MIB = 1024 * 1024;

export interface ImportLimits {
    /** Largest request body, in bytes. */
    compressedBytes: number;
    /** Largest sum of every entry's decompressed size, in bytes. */
    uncompressedBytes: number;
    /** Most zip entries (manifest, outbox, media index, Yjs states and photos). */
    entries: number;
    /** Most inspections the manifest may name. */
    inspections: number;
    /** Most queued writes in the outbox. */
    outbox: number;
    /** Most photos in the media index. */
    photos: number;
}

export type ImportLimitName = keyof ImportLimits;

export const DEFAULT_IMPORT_LIMITS: ImportLimits = {
    compressedBytes: 16 * MIB,
    uncompressedBytes: 48 * MIB,
    entries: 200,
    inspections: 8,
    outbox: 20,
    photos: 50,
};

/** The most an operator can raise each limit to. Also the bound the package schemas enforce. */
export const IMPORT_LIMIT_CEILINGS: ImportLimits = {
    compressedBytes: 24 * MIB,
    uncompressedBytes: 72 * MIB,
    entries: 2000,
    inspections: 200,
    outbox: 500,
    photos: 1500,
};

/** The least an operator can lower each limit to: a package needs at least these to mean anything. */
const IMPORT_LIMIT_FLOORS: ImportLimits = {
    compressedBytes: 64 * 1024,
    uncompressedBytes: 64 * 1024,
    entries: 4,
    inspections: 1,
    outbox: 1,
    photos: 1,
};

/** Operator-set overrides. All optional: unset means the default. */
export interface NativeImportEnv {
    NATIVE_IMPORT_MAX_COMPRESSED_BYTES?: string;
    NATIVE_IMPORT_MAX_UNCOMPRESSED_BYTES?: string;
    NATIVE_IMPORT_MAX_ENTRIES?: string;
    NATIVE_IMPORT_MAX_INSPECTIONS?: string;
    NATIVE_IMPORT_MAX_OUTBOX?: string;
    NATIVE_IMPORT_MAX_PHOTOS?: string;
}

const ENV_KEYS: Record<ImportLimitName, keyof NativeImportEnv> = {
    compressedBytes: 'NATIVE_IMPORT_MAX_COMPRESSED_BYTES',
    uncompressedBytes: 'NATIVE_IMPORT_MAX_UNCOMPRESSED_BYTES',
    entries: 'NATIVE_IMPORT_MAX_ENTRIES',
    inspections: 'NATIVE_IMPORT_MAX_INSPECTIONS',
    outbox: 'NATIVE_IMPORT_MAX_OUTBOX',
    photos: 'NATIVE_IMPORT_MAX_PHOTOS',
};

function readOne(raw: string | undefined, name: ImportLimitName): number {
    const text = raw?.trim();
    if (!text || !/^\d{1,15}$/.test(text)) return DEFAULT_IMPORT_LIMITS[name];
    const value = Number(text);
    return Math.min(IMPORT_LIMIT_CEILINGS[name], Math.max(IMPORT_LIMIT_FLOORS[name], value));
}

export function readImportLimits(env: NativeImportEnv): ImportLimits {
    return {
        compressedBytes: readOne(env[ENV_KEYS.compressedBytes], 'compressedBytes'),
        uncompressedBytes: readOne(env[ENV_KEYS.uncompressedBytes], 'uncompressedBytes'),
        entries: readOne(env[ENV_KEYS.entries], 'entries'),
        inspections: readOne(env[ENV_KEYS.inspections], 'inspections'),
        outbox: readOne(env[ENV_KEYS.outbox], 'outbox'),
        photos: readOne(env[ENV_KEYS.photos], 'photos'),
    };
}

/** Estimated subrequests for a package of this size; see the budget in the header. */
export function estimateSubrequests(counts: Pick<ImportLimits, 'inspections' | 'outbox' | 'photos'>): number {
    return 70 + counts.inspections * 22 + counts.outbox * 20 + counts.photos * 3;
}

/** The part of the limits a client needs in order to split a package. */
function clientVisibleLimits(limits: ImportLimits): Pick<ImportLimits, 'inspections' | 'outbox' | 'photos' | 'compressedBytes'> {
    return { inspections: limits.inspections, outbox: limits.outbox, photos: limits.photos, compressedBytes: limits.compressedBytes };
}

export interface LimitExceeded {
    limit: ImportLimitName;
    max: number;
    actual: number;
}

const LIMIT_LABELS: Record<ImportLimitName, string> = {
    compressedBytes: 'package size in bytes',
    uncompressedBytes: 'unpacked size in bytes',
    entries: 'archive entries',
    inspections: 'inspections',
    outbox: 'queued writes',
    photos: 'photos',
};

/**
 * The refusal for a package over a limit. A count is a well-formed request the
 * server will not process (422); a size is the body itself being too large (413).
 * `details.limits` is what a client needs to split the package.
 */
export function packageTooLarge(exceeded: LimitExceeded, limits: ImportLimits): AppError {
    const isSize = exceeded.limit === 'compressedBytes' || exceeded.limit === 'uncompressedBytes';
    return new AppError(
        isSize ? 413 : 422,
        ErrorCode.PACKAGE_TOO_LARGE,
        `Offline package is over this server's import limit for ${LIMIT_LABELS[exceeded.limit]} (limit ${exceeded.max}, package has ${exceeded.actual}). Split it into smaller packages.`,
        { limit: exceeded.limit, max: exceeded.max, actual: exceeded.actual, limits: clientVisibleLimits(limits) },
    );
}

/** Throws when `actual` is over the limit named. */
export function enforceLimit(limits: ImportLimits, limit: ImportLimitName, actual: number): void {
    if (actual > limits[limit]) throw packageTooLarge({ limit, max: limits[limit], actual }, limits);
}
