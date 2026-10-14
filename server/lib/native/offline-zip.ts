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
 * back truncated and looking valid. Entries are therefore inflated here, counting
 * every byte the stream produces, and accepted only when exactly the declared
 * number of bytes came out. A stored (method 0) entry must have a
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
 * CPU cost. fflate's one-shot inflate runs a whole deflate stream to its end
 * before it returns, so a buffer of `declared + 1` bytes would bound the MEMORY of
 * a stream that expands beyond its declaration but not the work: deflate
 * compresses zeros about 1000:1, and a 256 MiB stream (262 KB on the wire) costs
 * over a second of CPU to run to its end even when every byte past the buffer is
 * discarded. The compressed size does not bound that either: an entry may
 * declare as much as it carries and still expand a thousand-fold. Reading a
 * package therefore bounds the work three ways, all before anything is written:
 *
 *  - the directory is judged without inflating: an entry's compressed length may
 *    not exceed what a deflate encoder can legitimately produce for its declared
 *    size (`maxCompressedFor`), and a stored entry's must equal its declared size;
 *  - no two entries may share compressed bytes. The directory can point several
 *    entries at one compressed run, which would repeat one stream once per entry;
 *    every entry's data region, found from its local header, must be disjoint from
 *    every other and lie inside the body;
 *  - an entry is inflated incrementally and abandoned the moment its output passes
 *    the declared size. The compressed input is fed in slices sized so that even
 *    at the format's maximum expansion (1032:1) the output cannot pass the
 *    remaining allowance by more than a small multiple, so the work an entry can
 *    cost is a small constant times its declared size (plus a fixed slack of
 *    about 130 KB), never a function of what its stream could expand to.
 *
 * The first two checks reject a directory that is already inconsistent; the third
 * is what bounds CPU, because a stream that declares as much as it carries can
 * still expand a thousand-fold. Summed over entries the declared sizes are capped
 * by the unpacked-size limit (48 MiB by default).
 *
 * Memory. The inflater hands its output over per push, and one push is bounded by
 * the slice size above, so a single push can buffer about twice the remaining
 * allowance plus the fixed slack: roughly 2x an entry's declared size. The largest
 * entry is a photo (`MAX_MEDIA_ENTRY_BYTES`, 10 MiB), so that is about 20 MiB at
 * most, on top of the compressed package and the output buffer, and far below the
 * Worker's 128 MB.
 */

import { Inflate, unzipSync, type UnzipFileInfo } from 'fflate';
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
    if (refusal) return { ok: false, reason: refusal, ...(exceeded ? { exceeded } : {}) };
    // The listing above is fflate's reading of the directory. The checks that need each entry's
    // data region (its extent, and that no two share bytes) use the reader every later step uses.
    const directory = readDirectory(zip);
    return directory.ok ? { ok: true, entries } : { ok: false, reason: directory.reason };
}

interface DirectoryEntry {
    method: number;
    compressedSize: number;
    /** Where the entry's data begins: after its local header. */
    dataStart: number;
}

type DirectoryRead = { ok: true; entries: Map<string, DirectoryEntry> } | { ok: false; reason: string };

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const ZIP64_MARKER = 0xffffffff;
const UNREADABLE: DirectoryRead = { ok: false, reason: 'not a valid zip archive' };

/**
 * The most compressed bytes a deflate encoder can honestly produce for `declared`
 * bytes. Storing everything is the worst case (5 bytes of framing per 65535), so
 * the declared size plus one byte in 256 plus a fixed allowance covers every real
 * encoder. Anything longer is padding, or a stream that does not match its declaration.
 */
function maxCompressedFor(declared: number): number {
    return declared + Math.ceil(declared / 256) + 128;
}

/**
 * The central directory, read the way `listPackage` read it (same end-of-central-
 * directory search, same entry order), so a name judged by the listing is the
 * name read here. Refuses what it cannot place with certainty, including zip64
 * archives, which a package of this size never needs, and what could make the
 * inflater do more work than the directory declares (see the file comment): a
 * compressed length no encoder would produce for the declared size, and entries
 * whose compressed bytes overlap or leave the body.
 */
function readDirectory(zip: Uint8Array): DirectoryRead {
    if (zip.length < 22) return UNREADABLE;
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    let eocd = zip.length - 22;
    while (view.getUint32(eocd, true) !== EOCD_SIGNATURE) {
        if (eocd === 0 || zip.length - eocd > 65558) return UNREADABLE;
        eocd--;
    }
    const count = view.getUint16(eocd + 8, true);
    let at = view.getUint32(eocd + 16, true);
    if (count === 0xffff || at === ZIP64_MARKER) return UNREADABLE;

    const entries = new Map<string, DirectoryEntry>();
    for (let i = 0; i < count; i++) {
        if (at + 46 > zip.length || view.getUint32(at, true) !== CENTRAL_SIGNATURE) return UNREADABLE;
        const flags = view.getUint16(at + 8, true);
        const method = view.getUint16(at + 10, true);
        const compressedSize = view.getUint32(at + 20, true);
        const originalSize = view.getUint32(at + 24, true);
        const nameLength = view.getUint16(at + 28, true);
        const extraLength = view.getUint16(at + 30, true);
        const commentLength = view.getUint16(at + 32, true);
        const localOffset = view.getUint32(at + 42, true);
        if (compressedSize === ZIP64_MARKER || originalSize === ZIP64_MARKER || localOffset === ZIP64_MARKER || (flags & 1) !== 0) return UNREADABLE;
        if (at + 46 + nameLength > zip.length) return UNREADABLE;
        let name = '';
        for (let k = 0; k < nameLength; k++) name += String.fromCharCode(zip[at + 46 + k]!);
        if (localOffset + 30 > zip.length || view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) return UNREADABLE;
        const dataStart = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
        if (dataStart + compressedSize > zip.length) return UNREADABLE;
        if (method === 0 && compressedSize !== originalSize) {
            return { ok: false, reason: `entry ${name} is stored with a length that differs from its declared size` };
        }
        if (method === 8 && compressedSize > maxCompressedFor(originalSize)) {
            return { ok: false, reason: `entry ${name} carries more compressed data than its declared size allows` };
        }
        entries.set(name, { method, compressedSize, dataStart });
        at += 46 + nameLength + extraLength + commentLength;
    }

    // Data regions must be disjoint. Checked in order of position; an empty region cannot be shared.
    const regions = [...entries].filter(([, e]) => e.compressedSize > 0).sort((x, y) => x[1].dataStart - y[1].dataStart);
    for (let i = 1; i < regions.length; i++) {
        const [, previous] = regions[i - 1]!;
        const [name, current] = regions[i]!;
        if (current.dataStart < previous.dataStart + previous.compressedSize) {
            return { ok: false, reason: `entry ${name} shares compressed data with another entry` };
        }
    }
    return { ok: true, entries };
}

/**
 * Fewest compressed bytes fed to the inflater in one step, and the shift that
 * sizes the rest: a step is `allowance >> SLICE_SHIFT` bytes, the allowance being
 * what the entry may still produce. Deflate expands at most 1032:1, so one step
 * can overshoot the allowance by about twice the allowance (1032 / 2^9) plus
 * 1032 * MIN_SLICE (132 KB), and steps shrink with the allowance, so an entry
 * takes a few thousand steps at most.
 */
const MIN_SLICE = 128;
const SLICE_SHIFT = 9;

/** Inflate a deflate stream into `out`, giving up as soon as it has produced more than `declared`. */
function inflateBounded(data: Uint8Array, declared: number, out: Uint8Array): boolean {
    let produced = 0;
    let over = false;
    const inflater = new Inflate((chunk) => {
        if (over) return;
        if (produced + chunk.byteLength > declared) {
            over = true;
            return;
        }
        out.set(chunk, produced);
        produced += chunk.byteLength;
    });
    try {
        for (let at = 0; at < data.length && !over;) {
            const end = Math.min(data.length, at + Math.max(MIN_SLICE, (declared - produced) >> SLICE_SHIFT));
            inflater.push(data.subarray(at, end), end === data.length);
            at = end;
        }
    } catch {
        return false;
    }
    return !over && produced === declared;
}

/**
 * Inflate one entry into `out` (at least `declared` bytes) and return how many
 * bytes it produced, or null when it is not exactly `declared` bytes. A stream
 * longer than declared is abandoned the moment it passes the declaration (see
 * `inflateBounded`), so it never costs more than the declaration allows.
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
    if (data.length > maxCompressedFor(declared)) return null;
    if (data.length === 0) return declared === 0 ? 0 : null;
    return inflateBounded(data, declared, out) ? declared : null;
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
        if (!directory.ok) {
            yield [name, null];
            continue;
        }
        const out = new Uint8Array(declared);
        const length = inflateExact(zip, directory.entries.get(name), declared, out);
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
    if (!directory.ok) return wanted.keys().next().value ?? null;
    let scratch = new Uint8Array(0);
    for (const [name, declared] of wanted) {
        if (scratch.length < declared) scratch = new Uint8Array(declared);
        if (inflateExact(zip, directory.entries.get(name), declared, scratch) === null) return name;
    }
    return null;
}
