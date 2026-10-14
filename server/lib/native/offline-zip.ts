/**
 * Reading an offline package without letting it hurt the Worker.
 *
 * A Worker has 128 MB of memory and a package is untrusted input, so every limit
 * here is enforced BEFORE the bytes it protects are produced:
 *
 *  - the request body is only read once its declared length is under the cap,
 *    as chunks, refusing any that would pass the declared length (no buffer is sized from
 *    the header, so a declaration alone costs nothing);
 *  - the zip's central directory is listed with a filter that decompresses
 *    nothing, and the entry count, every entry name, every declared size and the
 *    declared total are judged from that listing;
 *  - entries are then inflated one at a time, by name, so the working set is the
 *    compressed package plus one entry rather than the whole archive.
 *
 * An entry's size is checked EXACTLY, and the check does not trust fflate to do
 * it: fflate (0.8) writes into the output buffer it is handed and silently drops
 * anything past the end, so an entry whose directory understates its size comes
 * back truncated and looking valid. Entries are therefore inflated here, into a
 * buffer one byte larger than the declared size, and accepted only when exactly
 * the declared number of bytes came out. A stored (method 0) entry must have a
 * compressed length equal to its declared length. One entry that fails the check
 * refuses the whole package, and `verifyPackageEntries` runs it over every entry
 * during validation, before the import writes anything.
 *
 * CRC-32 is NOT verified, deliberately. Neither fflate nor this reader checks it,
 * and computing it costs a pass over every unpacked byte (up to 48 MiB at the
 * default limits, tens to hundreds of milliseconds of CPU), which the Workers
 * Free plan cannot afford on top of the inflate itself. What stands in for it:
 * the exact-size check above; JSON and Yjs entries must parse (a flipped bit in
 * them fails the parse); and a photo must pass the same content-type and size
 * checks as every other photo write. A package is an export of the user's own
 * device, authenticated by their session, not a tamper-evident transfer.
 *
 * Residual cost: a hostile entry that declares a small size and inflates to far
 * more is rejected, but the inflate still has to run to the end of its stream to
 * find that out (the extra output is discarded, not stored, so memory stays
 * fixed). Its CPU is bounded by the compressed size, which the body cap bounds.
 */

import { inflateSync, unzipSync, type UnzipFileInfo } from 'fflate';
import { MAX_PHOTO_BYTES } from '../media/store-photo';
import { MAX_IMPORT_BYTES } from '../../durable-objects/inspection-doc-import';
import { DEFAULT_IMPORT_LIMITS, type ImportLimits, type LimitExceeded } from './import-limits';
import { OFFLINE_ID_PATTERN } from './offline-package';

const MIB = 1024 * 1024;

/** Largest decompressed JSON entry (manifest, outbox, media index). */
const MAX_JSON_ENTRY_BYTES = 5 * MIB;
/** Largest decompressed Yjs update: the limit the document object itself enforces. */
const MAX_YJS_ENTRY_BYTES = MAX_IMPORT_BYTES;
/** Largest decompressed photo: the limit every photo write path enforces. */
export const MAX_MEDIA_ENTRY_BYTES = MAX_PHOTO_BYTES;

export const MANIFEST_ENTRY = 'manifest.json';
export const OUTBOX_ENTRY = 'outbox.json';
export const MEDIA_INDEX_ENTRY = 'media/index.json';

const MEDIA_EXTENSIONS = ['jpg', 'png', 'heic'] as const;
const ID = OFFLINE_ID_PATTERN.source.slice(1, -1);
/** The only entry names a package may contain; everything else is refused. */
const ALLOWED_ENTRY = new RegExp(
    String.raw`^(?:manifest\.json|outbox\.json|media/index\.json|yjs/${ID}\.bin|media/${ID}\.(?:${MEDIA_EXTENSIONS.join('|')}))$`,
);

export function yjsEntryName(inspectionId: string): string {
    return `yjs/${inspectionId}.bin`;
}

export function mediaEntryName(pendingId: string, ext: string): string {
    return `media/${pendingId}.${ext}`;
}

export type PackageListing =
    | { ok: true; entries: ReadonlyMap<string, number> }
    | { ok: false; reason: string; exceeded?: LimitExceeded };

function entryLimit(name: string): number {
    if (name.startsWith('yjs/')) return MAX_YJS_ENTRY_BYTES;
    if (name.endsWith('.json')) return MAX_JSON_ENTRY_BYTES;
    return MAX_MEDIA_ENTRY_BYTES;
}

/**
 * Judge a package from its directory alone. Nothing is inflated: the filter
 * records each entry and returns false, so a compression bomb is rejected on the
 * size it declares, before a single byte of it is produced.
 */
export function listPackage(zip: Uint8Array, limits: Pick<ImportLimits, 'entries' | 'uncompressedBytes'> = DEFAULT_IMPORT_LIMITS): PackageListing {
    const entries = new Map<string, number>();
    let refusal: string | null = null;
    let exceeded: LimitExceeded | undefined;
    let total = 0;
    let seen = 0;
    const note = (info: UnzipFileInfo): false => {
        // Counted even after a refusal so the report can say how many there were.
        seen++;
        if (exceeded?.limit === 'entries') exceeded.actual = seen;
        if (refusal) return false;
        if (seen > limits.entries) {
            refusal = 'too many entries';
            exceeded = { limit: 'entries', max: limits.entries, actual: seen };
        } else if (entries.has(info.name)) refusal = 'duplicate entry name';
        else if (!ALLOWED_ENTRY.test(info.name)) refusal = 'unexpected entry name';
        else if (info.compression !== 0 && info.compression !== 8) refusal = 'unsupported compression';
        else if (info.originalSize > entryLimit(info.name)) refusal = `entry too large: ${info.name}`;
        else {
            total += info.originalSize;
            if (total > limits.uncompressedBytes) {
                refusal = 'package too large once unpacked';
                exceeded = { limit: 'uncompressedBytes', max: limits.uncompressedBytes, actual: total };
            } else entries.set(info.name, info.originalSize);
        }
        return false;
    };
    try {
        unzipSync(zip, { filter: note });
    } catch {
        return { ok: false, reason: 'not a valid zip archive' };
    }
    return refusal ? { ok: false, reason: refusal, ...(exceeded ? { exceeded } : {}) } : { ok: true, entries };
}

interface DirectoryEntry {
    method: number;
    compressedSize: number;
    /** Where the entry's data begins: after its local header. */
    dataStart: number;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const ZIP64_MARKER = 0xffffffff;

/**
 * The central directory, read the way `listPackage` read it (same end-of-central-
 * directory search, same entry order), so a name judged by the listing is the
 * name read here. Returns null for anything it cannot place with certainty,
 * including zip64 archives, which a package of this size never needs.
 */
function readDirectory(zip: Uint8Array): Map<string, DirectoryEntry> | null {
    if (zip.length < 22) return null;
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    let eocd = zip.length - 22;
    while (view.getUint32(eocd, true) !== EOCD_SIGNATURE) {
        if (eocd === 0 || zip.length - eocd > 65558) return null;
        eocd--;
    }
    const count = view.getUint16(eocd + 8, true);
    let at = view.getUint32(eocd + 16, true);
    if (count === 0xffff || at === ZIP64_MARKER) return null;

    const entries = new Map<string, DirectoryEntry>();
    for (let i = 0; i < count; i++) {
        if (at + 46 > zip.length || view.getUint32(at, true) !== CENTRAL_SIGNATURE) return null;
        const flags = view.getUint16(at + 8, true);
        const method = view.getUint16(at + 10, true);
        const compressedSize = view.getUint32(at + 20, true);
        const nameLength = view.getUint16(at + 28, true);
        const extraLength = view.getUint16(at + 30, true);
        const commentLength = view.getUint16(at + 32, true);
        const localOffset = view.getUint32(at + 42, true);
        if (compressedSize === ZIP64_MARKER || localOffset === ZIP64_MARKER || (flags & 1) !== 0) return null;
        if (at + 46 + nameLength > zip.length) return null;
        let name = '';
        for (let k = 0; k < nameLength; k++) name += String.fromCharCode(zip[at + 46 + k]!);
        if (localOffset + 30 > zip.length || view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) return null;
        const dataStart = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
        if (dataStart + compressedSize > zip.length) return null;
        entries.set(name, { method, compressedSize, dataStart });
        at += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
}

/**
 * Inflate one entry into `out` (at least `declared + 1` bytes) and return how
 * many bytes it produced, or null when it is not exactly `declared` bytes. The
 * spare byte is what makes "too long" visible: fflate stops writing at the end
 * of the buffer it is given but keeps counting, so a stream that is longer than
 * declared fills the spare byte and reports `declared + 1`.
 */
function inflateExact(zip: Uint8Array, entry: DirectoryEntry | undefined, declared: number, out: Uint8Array): number | null {
    if (!entry) return null;
    const data = zip.subarray(entry.dataStart, entry.dataStart + entry.compressedSize);
    if (entry.method === 0) {
        if (entry.compressedSize !== declared) return null;
        out.set(data);
        return declared;
    }
    if (entry.method !== 8) return null;
    if (data.length === 0) return declared === 0 ? 0 : null;
    try {
        const got = inflateSync(data, { out: out.subarray(0, declared + 1) });
        return got.byteLength === declared ? declared : null;
    } catch {
        return null;
    }
}

/**
 * Inflate entries that `listPackage` accepted, in the order given. `wanted` maps
 * each entry name to the size the directory declared for it; an entry that does
 * not inflate to exactly that size (a damaged or lying archive) comes back as
 * null. The directory is read once; each entry gets its own right-sized buffer,
 * so the working set is the compressed package plus the entry being read. The
 * caller should drop an entry before asking for the next one.
 */
export function* readPackageEntries(
    zip: Uint8Array,
    wanted: ReadonlyMap<string, number>,
): Generator<[name: string, bytes: Uint8Array | null]> {
    const directory = readDirectory(zip);
    for (const [name, declared] of wanted) {
        if (!directory) {
            yield [name, null];
            continue;
        }
        const out = new Uint8Array(declared + 1);
        const length = inflateExact(zip, directory.get(name), declared, out);
        yield [name, length === null ? null : out.subarray(0, length)];
    }
}

/** One entry, at the size the directory declared. Null when the archive does not yield it. */
export function readPackageEntry(zip: Uint8Array, name: string, declaredSize: number): Uint8Array | null {
    for (const [, bytes] of readPackageEntries(zip, new Map([[name, declaredSize]]))) return bytes;
    return null;
}

/**
 * Check, before anything is written, that every entry holds exactly the bytes
 * its directory entry declares. Inflates into one scratch buffer shared by all
 * entries and keeps nothing, so it costs one extra inflate of the package and no
 * extra memory beyond the largest entry. Returns the name of the first entry
 * that fails, or null when all pass.
 */
export function verifyPackageEntries(zip: Uint8Array, wanted: ReadonlyMap<string, number>): string | null {
    const directory = readDirectory(zip);
    if (!directory) return wanted.keys().next().value ?? null;
    let scratch = new Uint8Array(0);
    for (const [name, declared] of wanted) {
        if (scratch.length < declared + 1) scratch = new Uint8Array(declared + 1);
        if (inflateExact(zip, directory.get(name), declared, scratch) === null) return name;
    }
    return null;
}

export type BoundedBody = { ok: true; bytes: Uint8Array } | { ok: false; status: 400 | 411 | 413 };

/**
 * Read the whole request body, never holding more than has actually arrived.
 * The declared length is checked against the cap and against what the stream
 * delivers, but it is NOT used to size a buffer: a client that declares the
 * maximum and then sends nothing would otherwise pin that much memory per
 * request for as long as it cared to wait. Chunks are collected as they come and
 * joined once at the end. A body that does not match its declared length is
 * refused rather than truncated or padded, and nothing is read at all when the
 * declaration is missing, malformed or over the cap.
 */
export async function readPackageBody(req: Request, limit: number): Promise<BoundedBody> {
    const declared = req.headers.get('content-length');
    if (declared === null) return { ok: false, status: 411 };
    const length = Number(declared);
    if (!/^\d+$/.test(declared) || !Number.isSafeInteger(length)) return { ok: false, status: 400 };
    if (length > limit) return { ok: false, status: 413 };
    if (!req.body) return length === 0 ? { ok: true, bytes: new Uint8Array(0) } : { ok: false, status: 400 };

    const chunks: Uint8Array[] = [];
    const reader = req.body.getReader();
    let filled = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (filled + value.byteLength > length) {
            await reader.cancel();
            return { ok: false, status: 400 };
        }
        chunks.push(value);
        filled += value.byteLength;
    }
    if (filled !== length) return { ok: false, status: 400 };
    const bytes = new Uint8Array(length);
    let at = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, at);
        at += chunk.byteLength;
    }
    // Drop the pieces now that they are joined, so the peak stays near one copy.
    chunks.length = 0;
    return { ok: true, bytes };
}
