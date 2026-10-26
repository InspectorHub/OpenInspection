/** The smallest leading bytes that identify each accepted upload type, for specs that store a "photo" or a "video". */
const ascii = (s: string): number[] => [...s].map((ch) => ch.charCodeAt(0));
const ftyp = (major: string, ...compatible: string[]): Uint8Array<ArrayBuffer> =>
    new Uint8Array([0, 0, 0, 24, ...ascii('ftyp'), ...ascii(major), 0, 0, 0, 0, ...compatible.flatMap(ascii)]);

export const JPEG_BYTES: Uint8Array<ArrayBuffer> = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 1, 2, 3]);
export const PNG_BYTES: Uint8Array<ArrayBuffer> = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
export const HEIC_BYTES: Uint8Array<ArrayBuffer> = ftyp('heic', 'mif1');
/** A heic file whose major brand is not a heif one: only a compatible brand marks it. */
export const MIF1_ONLY_BYTES: Uint8Array<ArrayBuffer> = ftyp('isom', 'mif1');
export const AVIF_BYTES: Uint8Array<ArrayBuffer> = ftyp('avif', 'mif1', 'miaf');
export const WEBP_BYTES: Uint8Array<ArrayBuffer> = new Uint8Array([...ascii('RIFF'), 1, 2, 3, 4, ...ascii('WEBP'), 0]);
export const MP4_BYTES: Uint8Array<ArrayBuffer> = ftyp('isom', 'mp42');
export const MOV_BYTES: Uint8Array<ArrayBuffer> = ftyp('qt  ', 'qt  ');
export const WEBM_BYTES: Uint8Array<ArrayBuffer> = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81]);
export const SVG_BYTES: Uint8Array<ArrayBuffer> = new Uint8Array(ascii('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'));
export const HTML_BYTES: Uint8Array<ArrayBuffer> = new Uint8Array(ascii('<!DOCTYPE html><script>alert(1)</script>'));
export const ZIP_BYTES: Uint8Array<ArrayBuffer> = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
export const EXE_BYTES: Uint8Array<ArrayBuffer> = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 3, 0, 0, 0]);
