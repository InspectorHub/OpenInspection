/**
 * The numeric limits an offline package is held to. Pure data: how a deployment
 * reads its own overrides, and the refusal raised when a package is over a
 * limit, stay with the server that enforces them.
 */

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
