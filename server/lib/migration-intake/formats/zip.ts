/**
 * One named entry out of a zip archive, as bytes.
 *
 * ── Why the central directory and not a scan ────────────────────────────────
 * The obvious reader scans forward for local file headers and compares the name
 * that follows each one. That reader is wrong on real files: an entry name is
 * ordinary text and can appear inside another entry's DATA, so the scan finds
 * the occurrence rather than the file and hands back whatever follows it. The
 * end-of-central-directory record is the archive's own index, and walking it is
 * the only way to be sure a name resolves to the entry it names.
 *
 * ── Why no library ──────────────────────────────────────────────────────────
 * The Worker bundle ceiling is 3 MiB gzipped and a self-hosted deploy genuinely
 * fails above it. Decompression is the platform's — `DecompressionStream`,
 * which workerd provides — so what is left is header arithmetic.
 *
 * ── Why null and never a throw ──────────────────────────────────────────────
 * A file that is not a zip is an operator's mistake. Throwing turns it into an
 * unhandled server condition and loses the sentence that would have told them
 * what to upload instead.
 */

/** The four signatures this reader recognises, as little-endian 32-bit words. */
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_FILE_HEADER = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;

/** Fixed sizes, from the format's own specification. */
const EOCD_SIZE = 22;
const CENTRAL_HEADER_SIZE = 46;
const LOCAL_HEADER_SIZE = 30;

/**
 * The largest trailing comment the format allows, which bounds how far back the
 * end record can sit. Scanning further than this would be scanning the file.
 */
const MAX_TRAILING_COMMENT = 0xffff;

const STORED = 0;
const DEFLATED = 8;

function viewOf(bytes: Uint8Array): DataView {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** Where the end-of-central-directory record starts, or -1 when there is none. */
function findEndRecord(view: DataView, length: number): number {
    if (length < EOCD_SIZE) return -1;
    const earliest = Math.max(0, length - EOCD_SIZE - MAX_TRAILING_COMMENT);
    for (let at = length - EOCD_SIZE; at >= earliest; at--) {
        if (view.getUint32(at, true) === END_OF_CENTRAL_DIRECTORY) return at;
    }
    return -1;
}

/** Where an entry's DATA begins, reading the local header's own name and extra lengths. */
function dataStart(view: DataView, localOffset: number, length: number): number | null {
    if (localOffset + LOCAL_HEADER_SIZE > length) return null;
    if (view.getUint32(localOffset, true) !== LOCAL_FILE_HEADER) return null;
    // The local header's name and extra lengths are read from the LOCAL header
    // rather than reused from the central one: the two are allowed to differ in
    // their extra fields, and a writer that pads one and not the other would
    // otherwise shift every read by the difference.
    const nameLength = view.getUint16(localOffset + 26, true);
    const extraLength = view.getUint16(localOffset + 28, true);
    const start = localOffset + LOCAL_HEADER_SIZE + nameLength + extraLength;
    return start <= length ? start : null;
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array | null> {
    try {
        const stream = new Blob([bytes]).stream()
            .pipeThrough(new DecompressionStream('deflate-raw'));
        return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
        // Corrupt compressed data, which is the same class of problem as a file
        // that is not a zip: the operator has to send a different file.
        return null;
    }
}

/**
 * The named entry's bytes, or null when the archive does not hold it, is not an
 * archive, or is damaged.
 *
 * Names are compared exactly, including any directory prefix — `xl/worksheets/
 * sheet1.xml` is a name, not a path this reader resolves.
 */
export async function readZipEntry(bytes: Uint8Array, name: string): Promise<Uint8Array | null> {
    const length = bytes.byteLength;
    const view = viewOf(bytes);
    const endAt = findEndRecord(view, length);
    if (endAt < 0) return null;

    const entryCount = view.getUint16(endAt + 10, true);
    const directoryOffset = view.getUint32(endAt + 16, true);
    if (directoryOffset >= length) return null;

    const wanted = new TextEncoder().encode(name);
    let at = directoryOffset;
    for (let index = 0; index < entryCount; index++) {
        if (at + CENTRAL_HEADER_SIZE > length) return null;
        if (view.getUint32(at, true) !== CENTRAL_FILE_HEADER) return null;
        const method = view.getUint16(at + 10, true);
        const compressedSize = view.getUint32(at + 20, true);
        const nameLength = view.getUint16(at + 28, true);
        const extraLength = view.getUint16(at + 30, true);
        const commentLength = view.getUint16(at + 32, true);
        const localOffset = view.getUint32(at + 42, true);
        const nameAt = at + CENTRAL_HEADER_SIZE;
        if (nameAt + nameLength > length) return null;

        if (nameLength === wanted.length) {
            let same = true;
            for (let i = 0; i < nameLength; i++) {
                if (bytes[nameAt + i] !== wanted[i]) { same = false; break; }
            }
            if (same) {
                const start = dataStart(view, localOffset, length);
                if (start === null) return null;
                const end = start + compressedSize;
                if (end > length) return null;
                const body = bytes.subarray(start, end);
                if (method === STORED) return body;
                if (method === DEFLATED) return inflateRaw(body);
                // Any other method — an archive this reader was not built for.
                // Guessing would produce bytes that parse as nothing.
                return null;
            }
        }
        at = nameAt + nameLength + extraLength + commentLength;
    }
    return null;
}
