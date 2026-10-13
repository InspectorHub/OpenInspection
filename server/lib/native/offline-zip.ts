/**
 * Reading an offline package without letting it hurt the Worker.
 *
 * A Worker has 128 MB of memory and a package is untrusted input, so every limit
 * here is enforced BEFORE the bytes it protects are produced:
 *
 *  - the request body is only read once its declared length is under the cap,
 *    into a buffer allocated at that length, so the transfer cannot grow past it;
 *  - the zip's central directory is listed with a filter that decompresses
 *    nothing, and the entry count, every entry name, every declared size and the
 *    declared total are judged from that listing;
 *  - entries are then inflated one at a time, by name, so the working set is the
 *    compressed package plus one entry rather than the whole archive.
 *
 * fflate allocates each entry's output at the size the directory declares and does
 * not grow it. A directory that understates an entry therefore truncates it (it
 * cannot make the Worker allocate more); a truncated entry fails the parse that
 * follows (JSON, Yjs update) or is caught by the declared-size comparison below.
 */

import { unzipSync, type UnzipFileInfo } from 'fflate';
import { MAX_PHOTO_BYTES } from '../media/store-photo';
import { MAX_IMPORT_BYTES } from '../../durable-objects/inspection-doc-import';
import { OFFLINE_ID_PATTERN } from './offline-package';

const MIB = 1024 * 1024;

/**
 * Largest request body accepted. Kept well under the Worker's memory because the
 * package is held in full while its entries are read; photos are already
 * compressed images, so this bounds the photo payload too. A bigger package
 * should be split into several, each of which imports on its own.
 */
export const MAX_PACKAGE_BYTES = 24 * MIB;
/** Most entries one package may hold (one manifest, one outbox, one media index, plus yjs and media). */
export const MAX_PACKAGE_ENTRIES = 2000;
/** Largest decompressed JSON entry (manifest, outbox, media index). */
const MAX_JSON_ENTRY_BYTES = 5 * MIB;
/** Largest decompressed Yjs update: the limit the document object itself enforces. */
const MAX_YJS_ENTRY_BYTES = MAX_IMPORT_BYTES;
/** Largest decompressed photo: the limit every photo write path enforces. */
export const MAX_MEDIA_ENTRY_BYTES = MAX_PHOTO_BYTES;
/**
 * Sum of every entry's declared decompressed size. Three times the compressed cap:
 * it bounds the total work an import may be asked to do, while the one-entry-at-a
 * -time reading below is what bounds memory.
 */
const MAX_PACKAGE_UNCOMPRESSED_BYTES = 72 * MIB;

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
    | { ok: false; reason: string };

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
export function listPackage(zip: Uint8Array): PackageListing {
    const entries = new Map<string, number>();
    let refusal: string | null = null;
    let total = 0;
    const note = (info: UnzipFileInfo): false => {
        if (refusal) return false;
        if (entries.size >= MAX_PACKAGE_ENTRIES) refusal = 'too many entries';
        else if (entries.has(info.name)) refusal = 'duplicate entry name';
        else if (!ALLOWED_ENTRY.test(info.name)) refusal = 'unexpected entry name';
        else if (info.compression !== 0 && info.compression !== 8) refusal = 'unsupported compression';
        else if (info.originalSize > entryLimit(info.name)) refusal = `entry too large: ${info.name}`;
        else {
            total += info.originalSize;
            if (total > MAX_PACKAGE_UNCOMPRESSED_BYTES) refusal = 'package too large once unpacked';
            else entries.set(info.name, info.originalSize);
        }
        return false;
    };
    try {
        unzipSync(zip, { filter: note });
    } catch {
        return { ok: false, reason: 'not a valid zip archive' };
    }
    return refusal ? { ok: false, reason: refusal } : { ok: true, entries };
}

/**
 * Inflate one entry that `listPackage` accepted. Null when the archive does not
 * yield it at the size the directory declared (a damaged or lying archive).
 */
export function readPackageEntry(zip: Uint8Array, name: string, declaredSize: number): Uint8Array | null {
    try {
        const out = unzipSync(zip, { filter: (info) => info.name === name });
        const bytes = out[name];
        return bytes && bytes.byteLength === declaredSize ? bytes : null;
    } catch {
        return null;
    }
}

export type BoundedBody = { ok: true; bytes: Uint8Array } | { ok: false; status: 400 | 411 | 413 };

/**
 * Read the whole request body into a buffer allocated at the declared length.
 * A body that does not match its declared length is refused rather than
 * truncated or padded, and nothing is read at all when the declaration is
 * missing, malformed or over the cap.
 */
export async function readPackageBody(req: Request, limit: number = MAX_PACKAGE_BYTES): Promise<BoundedBody> {
    const declared = req.headers.get('content-length');
    if (declared === null) return { ok: false, status: 411 };
    const length = Number(declared);
    if (!/^\d+$/.test(declared) || !Number.isSafeInteger(length)) return { ok: false, status: 400 };
    if (length > limit) return { ok: false, status: 413 };
    if (!req.body) return length === 0 ? { ok: true, bytes: new Uint8Array(0) } : { ok: false, status: 400 };

    const bytes = new Uint8Array(length);
    const reader = req.body.getReader();
    let filled = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (filled + value.byteLength > length) {
            await reader.cancel();
            return { ok: false, status: 400 };
        }
        bytes.set(value, filled);
        filled += value.byteLength;
    }
    return filled === length ? { ok: true, bytes } : { ok: false, status: 400 };
}
