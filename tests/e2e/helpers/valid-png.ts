/**
 * A small PNG that decodes. `tests/assets/test-logo.png` does not: its IHDR and IDAT chunks fail their CRC check,
 * so the upload pipeline logs "IHDR: CRC error" and the browser reports the photo as not loadable, which leaves the
 * annotator with no canvas. Specs that need a photo a browser can actually draw build one here instead.
 */
import { deflateSync } from 'zlib';

function crc32(bytes: Uint8Array): number {
    let c = ~0;
    for (const b of bytes) {
        c ^= b;
        for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const out = Buffer.alloc(8 + data.length + 4);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), 8 + data.length);
    return out;
}

/** A solid-colour RGB PNG of `size` x `size` pixels. */
export function validPng(size = 96): Buffer {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(size, 0);
    ihdr.writeUInt32BE(size, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 2; // colour type: RGB
    const row = Buffer.alloc(1 + size * 3);
    for (let x = 0; x < size; x++) {
        row[1 + x * 3] = 40;
        row[2 + x * 3] = 120;
        row[3 + x * 3] = 200;
    }
    const raw = Buffer.concat(Array.from({ length: size }, () => row));
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', deflateSync(raw)),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

/** The payload `setInputFiles` / `FileChooser.setFiles` take for it. */
export function validPngFile(name = 'photo.png') {
    return { name, mimeType: 'image/png', buffer: validPng() };
}
