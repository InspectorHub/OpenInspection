/**
 * A zip archive, built by hand, for the readers under
 * `server/lib/migration-intake/formats/`.
 *
 * Built here rather than checked in as a binary because every vendor container
 * this repository reads is a zip, and a fixture that cannot be read is
 * indistinguishable from a reader that cannot read — the failure this whole
 * area keeps guarding against. A helper whose bytes are assembled in the open
 * can be inspected when a test goes red.
 *
 * Both storage methods are produced: STORED (method 0) is the default because
 * it keeps the bytes legible, and DEFLATED (method 8) is available because the
 * reader's decompression path has to be exercised by something a test can hold.
 * Real vendor archives use both.
 */

/**
 * CRC-32 (IEEE 802.3), computed a nibble at a time against a 16-entry table.
 *
 * Correct rather than zero: a reader that verifies the checksum would accept a
 * zero-CRC fixture only by not verifying, and then the fixture would be proving
 * the absence of a check rather than the presence of a reader.
 */
const CRC_TABLE = ((): Uint32Array => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }
    return table;
})();

function crc32(bytes: Uint8Array): number {
    let c = 0xffffffff;
    for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
    const stream = new Blob([bytes as BlobPart]).stream()
        .pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

interface ZipOptions {
    /** Store entries with DEFLATE (method 8) instead of leaving them uncompressed. */
    deflate?: boolean;
}

interface PlannedEntry {
    nameBytes: Uint8Array;
    body: Uint8Array;
    crc: number;
    uncompressedSize: number;
    offset: number;
}

/** Little-endian writers. A zip is little-endian throughout, with no exceptions. */
function u16(view: DataView, at: number, value: number): void {
    view.setUint16(at, value, true);
}
function u32(view: DataView, at: number, value: number): void {
    view.setUint32(at, value >>> 0, true);
}

/**
 * A zip archive holding the named entries, each with the given text as UTF-8.
 *
 * Entry names may contain `/`; nothing here creates directory entries, which is
 * what real vendor archives do too — the path is simply part of the name.
 */
export async function zipOf(
    entries: Record<string, string>,
    options: ZipOptions = {},
): Promise<Uint8Array> {
    const method = options.deflate ? 8 : 0;
    const encoder = new TextEncoder();
    const planned: PlannedEntry[] = [];
    const localParts: Uint8Array[] = [];
    let offset = 0;

    for (const [name, text] of Object.entries(entries)) {
        const nameBytes = encoder.encode(name);
        const raw = encoder.encode(text);
        const body = method === 8 ? await deflateRaw(raw) : raw;
        const header = new Uint8Array(30 + nameBytes.length);
        const view = new DataView(header.buffer);
        u32(view, 0, 0x04034b50);
        u16(view, 4, 20);          // version needed
        u16(view, 6, 0);           // flags — no data descriptor, sizes are known here
        u16(view, 8, method);
        u16(view, 10, 0);          // modification time
        u16(view, 12, 0x21);       // modification date — 1980-01-01, the zip epoch
        u32(view, 14, crc32(raw));
        u32(view, 18, body.length);
        u32(view, 22, raw.length);
        u16(view, 26, nameBytes.length);
        u16(view, 28, 0);          // extra field length
        header.set(nameBytes, 30);
        localParts.push(header, body);
        planned.push({
            nameBytes, body, crc: crc32(raw), uncompressedSize: raw.length, offset,
        });
        offset += header.length + body.length;
    }

    const centralParts: Uint8Array[] = [];
    let centralSize = 0;
    for (const entry of planned) {
        const record = new Uint8Array(46 + entry.nameBytes.length);
        const view = new DataView(record.buffer);
        u32(view, 0, 0x02014b50);
        u16(view, 4, 20);          // version made by
        u16(view, 6, 20);          // version needed
        u16(view, 8, 0);           // flags
        u16(view, 10, method);
        u16(view, 12, 0);
        u16(view, 14, 0x21);
        u32(view, 16, entry.crc);
        u32(view, 20, entry.body.length);
        u32(view, 24, entry.uncompressedSize);
        u16(view, 28, entry.nameBytes.length);
        u16(view, 30, 0);          // extra
        u16(view, 32, 0);          // comment
        u16(view, 34, 0);          // disk number start
        u16(view, 36, 0);          // internal attributes
        u32(view, 38, 0);          // external attributes
        u32(view, 42, entry.offset);
        record.set(entry.nameBytes, 46);
        centralParts.push(record);
        centralSize += record.length;
    }

    const eocd = new Uint8Array(22);
    const eocdView = new DataView(eocd.buffer);
    u32(eocdView, 0, 0x06054b50);
    u16(eocdView, 4, 0);
    u16(eocdView, 6, 0);
    u16(eocdView, 8, planned.length);
    u16(eocdView, 10, planned.length);
    u32(eocdView, 12, centralSize);
    u32(eocdView, 16, offset);
    u16(eocdView, 20, 0);

    const all = [...localParts, ...centralParts, eocd];
    const total = all.reduce((n, part) => n + part.length, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const part of all) {
        out.set(part, at);
        at += part.length;
    }
    return out;
}
