/**
 * A real PNG, built byte by byte, for tests that need one pdf-lib can embed.
 *
 * -- WHY NOT A BASE64 BLOB PASTED INTO A SPEC --------------------------------
 * Because the SIZE is the thing under test. `placeSignature` refuses a mark with
 * too few pixels for the box it would fill, so a signature spec has to be able
 * to ask for 400x100 and then for something a box will out-scale. A pasted blob
 * is one fixed size, and every test written around it would be asserting on
 * whatever that happened to be.
 *
 * -- WHY NOT A LIBRARY -------------------------------------------------------
 * The whole encoder is a header, one uncompressed deflate block and two
 * checksums. A dependency for that is a dependency to audit, and this file is
 * shorter than its own lockfile entry would be.
 *
 * Grayscale, 8 bits, no interlacing — the simplest PNG that exists, and pdf-lib
 * embeds it exactly as it embeds any other.
 */

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
        let c = n;
        for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }
    return table;
})();

function crc32(bytes: Uint8Array): number {
    let c = 0xFFFFFFFF;
    for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}

function adler32(bytes: Uint8Array): number {
    let a = 1;
    let b = 0;
    for (const byte of bytes) {
        a = (a + byte) % 65521;
        b = (b + a) % 65521;
    }
    return ((b << 16) | a) >>> 0;
}

function u32(value: number): Uint8Array {
    return new Uint8Array([(value >>> 24) & 0xFF, (value >>> 16) & 0xFF, (value >>> 8) & 0xFF, value & 0xFF]);
}

function chunk(type: string, body: Uint8Array): Uint8Array {
    const name = new TextEncoder().encode(type);
    const typed = new Uint8Array(name.length + body.length);
    typed.set(name, 0);
    typed.set(body, name.length);
    const out = new Uint8Array(4 + typed.length + 4);
    out.set(u32(body.length), 0);
    out.set(typed, 4);
    out.set(u32(crc32(typed)), 4 + typed.length);
    return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
    const total = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const p of parts) {
        out.set(p, at);
        at += p.length;
    }
    return out;
}

/**
 * A solid grey PNG of exactly this many pixels.
 *
 * @param width in pixels — what `placeSignature` divides the box width by.
 * @param height in pixels.
 * @param grey 0 (black) to 255 (white). The value never matters to a test; a
 *   mid grey is used so a rendered page differs visibly from a blank one.
 */
export function pngOf(width: number, height: number, grey = 0x40): Uint8Array {
    // One filter byte (0 = None) per scanline, then the row's samples.
    const raw = new Uint8Array(height * (1 + width));
    for (let y = 0; y < height; y += 1) {
        const row = y * (1 + width);
        raw[row] = 0;
        raw.fill(grey, row + 1, row + 1 + width);
    }
    // A zlib stream whose deflate blocks are all STORED — valid, and it keeps
    // this file free of a compressor. 65535 bytes is the format's block cap.
    const blocks: Uint8Array[] = [new Uint8Array([0x78, 0x01])];
    for (let at = 0; at < raw.length; at += 65535) {
        const slice = raw.subarray(at, Math.min(at + 65535, raw.length));
        const last = at + 65535 >= raw.length ? 1 : 0;
        blocks.push(new Uint8Array([
            last,
            slice.length & 0xFF, (slice.length >>> 8) & 0xFF,
            ~slice.length & 0xFF, (~slice.length >>> 8) & 0xFF,
        ]));
        blocks.push(slice);
    }
    blocks.push(u32(adler32(raw)));

    const ihdr = concat([
        u32(width), u32(height),
        new Uint8Array([8, 0, 0, 0, 0]), // 8-bit, grayscale, deflate, no filter, no interlace
    ]);
    return concat([
        new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
        chunk('IHDR', ihdr),
        chunk('IDAT', concat(blocks)),
        chunk('IEND', new Uint8Array()),
    ]);
}

/** The same image as a stored signature data URI, the shape `users` holds. */
export function pngDataUri(width: number, height: number): string {
    const bytes = pngOf(width, height);
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return `data:image/png;base64,${btoa(binary)}`;
}
