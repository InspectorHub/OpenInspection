/**
 * The uploaded file, and what FORM it is in.
 *
 * Split out of the registry because these are facts about the UPLOAD rather
 * than about which adapter claims it — and because the registry had grown past
 * the size this repository's ratchet allows. Nothing here imports an adapter,
 * so there is no cycle to reason about.
 */
import type { VendorId } from '../bundle';

/**
 * The uploaded file, as bytes plus the name the operator's machine gave it.
 *
 * BYTES, not text. Every real vendor export measured so far is a binary
 * container — a Spectora template export is XLSX, a Home Inspector Pro template
 * is a zip — and decoding one as UTF-8 to carry it through this layer destroys
 * it. `text()` is a method rather than a field so the decode happens only for
 * the adapters that want text, and never on the way in.
 */
export interface IntakeSource {
    readonly fileName: string;
    readonly bytes: Uint8Array;
    text(): string;
}

/** Build a source from the uploaded bytes. The production path. */
export function intakeSourceFromBytes(fileName: string, bytes: Uint8Array): IntakeSource {
    let decoded: string | null = null;
    return {
        fileName,
        bytes,
        text() {
            // Decoded at most once: `recognises`, `matchAdapter` and
            // `buildBundle` each ask, and a large CSV should not be decoded
            // three times on one request.
            if (decoded === null) decoded = new TextDecoder().decode(bytes);
            return decoded;
        },
    };
}

/**
 * Build a source from text.
 *
 * For callers that genuinely hold a string — a re-map reading a stored CSV back
 * — and for tests. It exists so no caller constructs the object literally:
 * `bytes` and `text()` have to agree, and an object literal is where they would
 * stop agreeing.
 */
export function intakeSourceFromText(fileName: string, text: string): IntakeSource {
    return intakeSourceFromBytes(fileName, new TextEncoder().encode(text));
}

/**
 * The vendors whose export is a binary container rather than text.
 *
 * A list rather than a property on the adapter, because the registry has to
 * answer this BEFORE it has an adapter in hand: `recognises` runs first, and it
 * is the guard that keeps a container away from a text reader.
 *
 * ⚠️ LITERAL-USE CLASSIFICATION: INDEPENDENTLY AUTHORED — the keys this
 * deployment files vendors under, not names read out of any file.
 */
export const CONTAINER_VENDORS: readonly VendorId[] = ['spectora', 'home_inspector_pro'];

/**
 * The vendor a plain spreadsheet is filed under, whoever exported it.
 *
 * ⚠️ LITERAL-USE CLASSIFICATION: INDEPENDENTLY AUTHORED — our own key.
 */
export const TABULAR_VENDOR: VendorId = 'csv_generic';

/**
 * Whether the bytes are a zip archive.
 *
 * Read from the FIRST four bytes rather than the file name, because the name is
 * the operator's and a container renamed to `.csv` is still a container. This
 * is the one question that can be asked of every vendor export without decoding
 * anything: every binary format this intake path reads is a zip underneath.
 */
export function isZipContainer(source: IntakeSource): boolean {
    const b = source.bytes;
    return b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
}
