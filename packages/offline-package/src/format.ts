/**
 * Reading and writing offline package archives.
 *
 * A package may contain exactly these entries and nothing else, because the
 * server refuses a whole package for one entry name it does not know:
 * `manifest.json`, `outbox.json`, `media/index.json`, `yjs/<id>.bin` and
 * `media/<pendingId>.<jpg|png|heic>`.
 *
 * Pure functions over bytes. No Node, DOM or server imports: the same code runs
 * in a browser tab, in the native client and in tests.
 */

import { unzipSync, zipSync, type Zippable } from 'fflate';
import { IMPORT_LIMIT_CEILINGS } from './limits';
import { MediaIndexSchema, OFFLINE_ID_PATTERN, OfflinePackageManifestSchema, OutboxSchema } from './manifest';
import type { MediaIndex, OfflinePackageManifest, OutboxEntry } from './manifest';

const MANIFEST_ENTRY = 'manifest.json';
const OUTBOX_ENTRY = 'outbox.json';
const MEDIA_INDEX_ENTRY = 'media/index.json';

const EXTENSION_BY_TYPE = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic' } as const;
const ID = OFFLINE_ID_PATTERN.source.slice(1, -1);
const ALLOWED_ENTRY = new RegExp(
    String.raw`^(?:manifest\.json|outbox\.json|media/index\.json|yjs/${ID}\.bin|media/${ID}\.(?:jpg|png|heic))$`,
);

export class PackageFormatError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'PackageFormatError';
    }
}

export interface PackageSummary {
    manifest: OfflinePackageManifest;
    counts: { inspections: number; writes: number; photos: number };
    /** Size of the archive itself. */
    bytes: number;
}

/** A package unpacked into memory, with everything keyed so it can be partitioned by inspection. */
export interface ParsedPackage {
    /** The manifest as written, so keys a later writer added survive a split. */
    manifestRaw: Readonly<Record<string, unknown>>;
    manifest: OfflinePackageManifest;
    outbox: readonly OutboxEntry[];
    media: MediaIndex;
    /** Yjs state by inspection id. */
    yjs: ReadonlyMap<string, Uint8Array>;
    /** Photo bytes by pending id. */
    photos: ReadonlyMap<string, Uint8Array>;
}

function yjsEntryName(inspectionId: string): string {
    return `yjs/${inspectionId}.bin`;
}

function mediaEntryName(pendingId: string, contentType: MediaIndex[number]['contentType']): string {
    return `media/${pendingId}.${EXTENSION_BY_TYPE[contentType]}`;
}

export interface ParseOptions {
    /** Most bytes the entries may declare unpacked, together. Defaults to the most an operator can raise the server's limit to. */
    maxUncompressedBytes?: number;
}

/**
 * The entry names in the archive's directory. Nothing is inflated, so the sizes the
 * directory declares are checked here, before any entry is.
 */
function listEntryNames(zip: Uint8Array, options: ParseOptions): string[] {
    const names: string[] = [];
    let declared = 0;
    try {
        unzipSync(zip, { filter: (file) => { names.push(file.name); declared += file.originalSize; return false; } });
    } catch {
        throw new PackageFormatError('not a valid zip archive');
    }
    if (declared > (options.maxUncompressedBytes ?? IMPORT_LIMIT_CEILINGS.uncompressedBytes)) {
        throw new PackageFormatError('the package declares more unpacked data than is allowed');
    }
    if (new Set(names).size !== names.length) throw new PackageFormatError('duplicate entry name');
    for (const name of names) {
        if (!ALLOWED_ENTRY.test(name)) throw new PackageFormatError(`unexpected entry name: ${name}`);
    }
    return names;
}

function inflateEntries(zip: Uint8Array, wanted: ReadonlySet<string>): Record<string, Uint8Array> {
    try {
        return unzipSync(zip, { filter: (file) => wanted.has(file.name) });
    } catch {
        throw new PackageFormatError('an entry could not be unpacked');
    }
}

function parseJson(bytes: Uint8Array | undefined, name: string, fallback: unknown): unknown {
    if (bytes === undefined) return fallback;
    try {
        return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
        throw new PackageFormatError(`${name} is not valid JSON`);
    }
}

function parseIndexes(files: Record<string, Uint8Array>): { manifestRaw: Record<string, unknown>; manifest: OfflinePackageManifest; outbox: OutboxEntry[]; media: MediaIndex } {
    const raw = parseJson(files[MANIFEST_ENTRY], MANIFEST_ENTRY, undefined);
    const manifest = OfflinePackageManifestSchema.safeParse(raw);
    if (!manifest.success) throw new PackageFormatError('manifest.json is missing or invalid');
    const outbox = OutboxSchema.safeParse(parseJson(files[OUTBOX_ENTRY], OUTBOX_ENTRY, []));
    if (!outbox.success) throw new PackageFormatError('outbox.json is invalid');
    const media = MediaIndexSchema.safeParse(parseJson(files[MEDIA_INDEX_ENTRY], MEDIA_INDEX_ENTRY, []));
    if (!media.success) throw new PackageFormatError('media/index.json is invalid');
    return { manifestRaw: raw as Record<string, unknown>, manifest: manifest.data, outbox: outbox.data, media: media.data };
}

/**
 * The manifest and the two indexes only. The directory is read and three small
 * entries are inflated; yjs states and photos are never touched, so a damaged
 * photo does not stop a preview.
 */
export function readPackageSummary(zip: Uint8Array, options: ParseOptions = {}): PackageSummary {
    listEntryNames(zip, options);
    const { manifest, outbox, media } = parseIndexes(inflateEntries(zip, new Set([MANIFEST_ENTRY, OUTBOX_ENTRY, MEDIA_INDEX_ENTRY])));
    return {
        manifest,
        counts: { inspections: manifest.inspections.length, writes: outbox.length, photos: media.length },
        bytes: zip.length,
    };
}

/**
 * Unpack a whole package and check it the way the server will: every id any
 * entry mentions is in the manifest, every manifest inspection has its Yjs state,
 * every indexed photo has its bytes, and nothing else is present.
 */
export function parsePackage(zip: Uint8Array, options: ParseOptions = {}): ParsedPackage {
    const names = listEntryNames(zip, options);
    const files = inflateEntries(zip, new Set(names));
    const { manifestRaw, manifest, outbox, media } = parseIndexes(files);

    const declared = new Set(manifest.inspections.map((i) => i.id));
    for (const entry of outbox) if (!declared.has(entry.payload.id)) throw new PackageFormatError('outbox names an inspection outside the manifest');
    for (const row of media) if (!declared.has(row.inspectionId)) throw new PackageFormatError('media index names an inspection outside the manifest');

    const yjs = new Map<string, Uint8Array>();
    const unclaimed = new Set(names.filter((n) => n.startsWith('yjs/')));
    for (const id of declared) {
        const name = yjsEntryName(id);
        const bytes = files[name];
        if (!bytes) throw new PackageFormatError(`no Yjs state for inspection ${id}`);
        unclaimed.delete(name);
        yjs.set(id, bytes);
    }
    if (unclaimed.size > 0) throw new PackageFormatError('a Yjs entry names an inspection outside the manifest');

    const photos = new Map<string, Uint8Array>();
    const unindexed = new Set(names.filter((n) => n.startsWith('media/') && n !== MEDIA_INDEX_ENTRY));
    for (const row of media) {
        const name = mediaEntryName(row.pendingId, row.contentType);
        const bytes = files[name];
        if (!bytes) throw new PackageFormatError(`photo ${row.pendingId} is missing or does not match its declared type`);
        unindexed.delete(name);
        photos.set(row.pendingId, bytes);
    }
    if (unindexed.size > 0) throw new PackageFormatError('a photo has no media index entry');

    return { manifestRaw, manifest, outbox, media, yjs, photos };
}

const encodeJson = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));

/**
 * Write the part of a parsed package that concerns `ids`, in manifest order.
 * Everything one inspection owns (its Yjs state, its queued writes, its photos)
 * moves together; nothing belonging to another inspection is included.
 */
export function writePackageFor(parsed: ParsedPackage, ids: ReadonlySet<string>): Uint8Array {
    const rows = parsed.manifest.inspections.filter((i) => ids.has(i.id));
    const files: Zippable = {
        [MANIFEST_ENTRY]: encodeJson({ ...parsed.manifestRaw, inspections: rows }),
        [OUTBOX_ENTRY]: encodeJson(parsed.outbox.filter((e) => ids.has(e.payload.id))),
    };
    const media = parsed.media.filter((m) => ids.has(m.inspectionId));
    files[MEDIA_INDEX_ENTRY] = encodeJson(media);
    for (const row of rows) files[yjsEntryName(row.id)] = parsed.yjs.get(row.id)!;
    // Photos are already compressed; deflating them again costs time and saves nothing.
    for (const m of media) files[mediaEntryName(m.pendingId, m.contentType)] = [parsed.photos.get(m.pendingId)!, { level: 0 }];
    return zipSync(files);
}
