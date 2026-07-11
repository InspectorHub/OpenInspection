/**
 * Commercial PCA Phase W Task 5 — minimal, dependency-free pixel-dimension
 * sniffer for JPEG and PNG bytes. The Word export consumer needs the source
 * photo's aspect ratio to pass correct `widthPx`/`heightPx` to the
 * `buildReportDocx` appendix embedder (server/lib/report-docx.ts), which uses
 * them only to compute a display-size ratio — it does not decode pixels, so a
 * header-only sniff is sufficient and avoids pulling in an image codec inside
 * the queue consumer.
 */
export interface SniffedImage {
    width: number;
    height: number;
    type: 'jpg' | 'png';
}

function sniffPng(bytes: Uint8Array): SniffedImage | null {
    // 8-byte signature, then a 4-byte length + "IHDR" chunk whose payload
    // starts with width (4 bytes) then height (4 bytes), both big-endian.
    const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (bytes.length < 24) return null;
    for (let i = 0; i < PNG_SIGNATURE.length; i++) {
        if (bytes[i] !== PNG_SIGNATURE[i]) return null;
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16, false);
    const height = view.getUint32(20, false);
    if (width <= 0 || height <= 0) return null;
    return { width, height, type: 'png' };
}

function sniffJpeg(bytes: Uint8Array): SniffedImage | null {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 2;
    while (offset + 9 < bytes.length) {
        if (bytes[offset] !== 0xff) { offset++; continue; }
        const marker = bytes[offset + 1] as number;
        // SOFn markers (Start Of Frame) carry the frame dimensions. Skip
        // markers with no length payload; DHT (0xC4)/JPG (0xC8)/DAC (0xCC)
        // are not SOF despite falling in the 0xC0-0xCF range.
        const isSof = marker >= 0xc0 && marker <= 0xcf
            && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
        if (isSof) {
            const height = view.getUint16(offset + 5, false);
            const width = view.getUint16(offset + 7, false);
            if (width > 0 && height > 0) return { width, height, type: 'jpg' };
            return null;
        }
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
            offset += 2; // markers with no length field
            continue;
        }
        const segmentLength = view.getUint16(offset + 2, false);
        offset += 2 + segmentLength;
    }
    return null;
}

/**
 * Best-effort dimension sniff. Tries PNG then JPEG signatures; returns `null`
 * (never throws) for any other/unrecognized format so the caller can fall
 * back to a safe default rather than failing the whole export over one photo.
 */
export function sniffImageDimensions(bytes: Uint8Array): SniffedImage | null {
    return sniffPng(bytes) ?? sniffJpeg(bytes);
}
