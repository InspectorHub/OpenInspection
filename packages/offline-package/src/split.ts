/**
 * Cutting a package into parts.
 *
 * The unit is always one inspection. Its Yjs state, its queued writes and its
 * photos travel together, and an inspection is never spread over two parts: a
 * photo split from the write that references it, or from the document that
 * resolves it, would be applied against nothing. Every part written here is a
 * package the server accepts on its own.
 */

import { DEFAULT_IMPORT_LIMITS, type ImportLimits } from './limits';
import { PackageFormatError, parsePackage, writePackageFor, type ParsedPackage } from './format';

/**
 * What a client can read from a refusal's `details.limits`: four numbers. The two
 * optional ones are not sent by the server (it has no figure for them to offer);
 * a caller that learns one another way may pass it.
 */
export interface PartLimits extends Pick<ImportLimits, 'inspections' | 'outbox' | 'photos' | 'compressedBytes'> {
    entries?: number;
    uncompressedBytes?: number;
}

export interface Part {
    /** The inspections this part carries, in manifest order. */
    ids: string[];
    bytes: Uint8Array;
}

export interface PartPlan {
    parts: Part[];
    /** Inspections that exceed the limits on their own and so cannot be sent. */
    tooLarge: string[];
}

export interface SplitResult {
    part: Uint8Array;
    /** Everything else, or null when `part` already holds every inspection. */
    rest: Uint8Array | null;
}

/** Bytes a part's archive framing and its three index entries cost, over and above their content. */
const PART_OVERHEAD_BYTES = 1024;
/** Zip framing per entry (local header, directory record, name). */
const ENTRY_OVERHEAD_BYTES = 160;
/** `manifest.json`, `outbox.json` and `media/index.json`. */
const FIXED_ENTRIES = 3;

interface Weight {
    writes: number;
    photos: number;
    hasCreate: boolean;
    /** Bytes the inspection's content occupies unpacked, plus its entry framing. */
    bytes: number;
}

function weighInspection(parsed: ParsedPackage, id: string): Weight {
    const writes = parsed.outbox.filter((e) => e.payload.id === id);
    const photos = parsed.media.filter((m) => m.inspectionId === id);
    const encoder = new TextEncoder();
    let bytes = parsed.yjs.get(id)?.length ?? 0;
    bytes += encoder.encode(JSON.stringify(writes)).length;
    bytes += encoder.encode(JSON.stringify(photos)).length;
    for (const m of photos) bytes += (parsed.photos.get(m.pendingId)?.length ?? 0) + ENTRY_OVERHEAD_BYTES;
    return {
        writes: writes.length,
        photos: photos.length,
        hasCreate: writes.some((e) => e.op === 'inspection.create'),
        bytes: bytes + ENTRY_OVERHEAD_BYTES,
    };
}

interface Totals { inspections: number; writes: number; photos: number; bytes: number }

const EMPTY: Totals = { inspections: 0, writes: 0, photos: 0, bytes: PART_OVERHEAD_BYTES };

function add(totals: Totals, weight: Weight): Totals {
    return {
        inspections: totals.inspections + 1,
        writes: totals.writes + weight.writes,
        photos: totals.photos + weight.photos,
        bytes: totals.bytes + weight.bytes,
    };
}

/**
 * `alone` asks whether one inspection can ever be sent, which decides that it is given up on.
 * The entry count and the unpacked size are only guesses until the server has named them, so
 * that verdict does not rest on a guess: the inspection is sent once and the refusal corrects it.
 * Grouping inspections into parts still uses the guess, which only costs a resend.
 */
function fitsWithin(totals: Totals, limits: PartLimits, alone = false): boolean {
    const entries = FIXED_ENTRIES + totals.inspections + totals.photos;
    // The server has no limit for the unpacked size to name, so a part is held to the default
    // ratio of unpacked to packed bytes, which no default package reaches.
    const unpacked = limits.uncompressedBytes
        ?? Math.max(DEFAULT_IMPORT_LIMITS.uncompressedBytes, limits.compressedBytes * (DEFAULT_IMPORT_LIMITS.uncompressedBytes / DEFAULT_IMPORT_LIMITS.compressedBytes));
    return totals.inspections <= Math.max(1, limits.inspections)
        && totals.writes <= limits.outbox
        && totals.photos <= limits.photos
        && (entries <= (limits.entries ?? DEFAULT_IMPORT_LIMITS.entries) || (alone && limits.entries === undefined))
        && (totals.bytes <= unpacked || (alone && limits.uncompressedBytes === undefined))
        && totals.bytes <= limits.compressedBytes;
}

/**
 * Cut the named inspections of an already parsed package into parts that each fit
 * `limits`. The part that carries an inspection's create comes first.
 */
export function planParsedParts(parsed: ParsedPackage, ids: readonly string[], limits: PartLimits): PartPlan {
    const wanted = new Set(ids);
    const order = parsed.manifest.inspections.map((i) => i.id).filter((id) => wanted.has(id));
    const weights = new Map(order.map((id) => [id, weighInspection(parsed, id)] as const));
    const ordered = [...order.filter((id) => weights.get(id)!.hasCreate), ...order.filter((id) => !weights.get(id)!.hasCreate)];

    const tooLarge: string[] = [];
    const groups: string[][] = [];
    let open: string[] = [];
    let totals = EMPTY;
    for (const id of ordered) {
        const weight = weights.get(id)!;
        if (!fitsWithin(add(EMPTY, weight), limits, true)) {
            tooLarge.push(id);
            continue;
        }
        if (open.length > 0 && !fitsWithin(add(totals, weight), limits)) {
            groups.push(open);
            open = [];
            totals = EMPTY;
        }
        open.push(id);
        totals = add(totals, weight);
    }
    if (open.length > 0) groups.push(open);

    // The byte figures above are estimates; the archive's real size is what the server measures.
    const parts: Part[] = [];
    const position = new Map(order.map((id, i) => [id, i] as const));
    const place = (members: string[]): void => {
        // Creates-first decided which inspections share a part; inside one, manifest order is kept.
        const group = [...members].sort((a, b) => position.get(a)! - position.get(b)!);
        const bytes = writePackageFor(parsed, new Set(group));
        if (bytes.length <= limits.compressedBytes) {
            parts.push({ ids: group, bytes });
        } else if (group.length > 1) {
            const half = Math.ceil(group.length / 2);
            place(group.slice(0, half));
            place(group.slice(half));
        } else {
            tooLarge.push(group[0]!);
        }
    };
    for (const group of groups) place(group);

    // Report in manifest order, and keep parts that carry a create ahead of those that do not.
    const rank = (part: Part): number => (part.ids.some((id) => weights.get(id)!.hasCreate) ? 0 : 1);
    return { parts: parts.map((p, i) => [p, i] as const).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([p]) => p), tooLarge: order.filter((id) => tooLarge.includes(id)) };
}

/** Cut a whole package into parts that each fit `limits`. */
export function planParts(zip: Uint8Array, limits: PartLimits): PartPlan {
    const parsed = parsePackage(zip);
    return planParsedParts(parsed, parsed.manifest.inspections.map((i) => i.id), limits);
}

/** Move the named inspections, whole, into `part`; the others stay in `rest`. */
function splitParsed(parsed: ParsedPackage, inspectionIds: readonly string[]): { part: Uint8Array; rest: Uint8Array | null } {
    const all = parsed.manifest.inspections.map((i) => i.id);
    const known = new Set(all);
    const named = new Set(inspectionIds);
    if (named.size === 0) throw new PackageFormatError('no inspection was named');
    for (const id of named) if (!known.has(id)) throw new PackageFormatError(`inspection ${id} is not in the package`);
    const remaining = new Set(all.filter((id) => !named.has(id)));
    return {
        part: writePackageFor(parsed, named),
        rest: remaining.size === 0 ? null : writePackageFor(parsed, remaining),
    };
}

export function splitPackage(zip: Uint8Array, inspectionIds: readonly string[]): SplitResult {
    return splitParsed(parsePackage(zip), inspectionIds);
}

/** A package of its own for inspections an import left behind, so they can be kept, fixed or handed on. */
export function extractHeldBackPackage(zip: Uint8Array, inspectionIds: readonly string[]): Uint8Array {
    return splitPackage(zip, inspectionIds).part;
}
