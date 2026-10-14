/**
 * Builds offline packages for the import specs. Nothing here is the code under
 * test: it writes the zip the way a device would, with fflate.
 */
import { zipSync } from 'fflate';

export interface PackageInspection { id: string; reportId: string }
export interface PackageOutboxEntry { idempotencyKey: string; op: string; payload: Record<string, unknown> }
export interface PackageMedia { pendingId: string; inspectionId: string; contentType: string; bytes?: Uint8Array; ext?: string }

export interface PackageSpec {
    tenantId: string;
    exportedBy?: string;
    deviceId?: string;
    inspections: PackageInspection[];
    /** Yjs state per inspection id. Omitted ids get no `yjs/` entry. */
    yjs?: Record<string, Uint8Array>;
    outbox?: PackageOutboxEntry[];
    media?: PackageMedia[];
    /** Overrides applied to the manifest object after it is built. */
    manifest?: Record<string, unknown>;
    /** Extra raw entries, written verbatim. */
    extra?: Record<string, Uint8Array>;
}

const enc = (v: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(v));

/** Minimal JPEG-looking bytes; the engine never decodes them without an Images binding. */
export const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);

function extensionFor(contentType: string): string {
    if (contentType === 'image/png') return 'png';
    if (contentType === 'image/heic') return 'heic';
    return 'jpg';
}

export function buildPackage(spec: PackageSpec): Uint8Array {
    const files: Record<string, Uint8Array> = {
        'manifest.json': enc({
            format: 'openinspection-offline-package',
            version: 1,
            tenantId: spec.tenantId,
            deviceId: spec.deviceId ?? 'device-1',
            exportedBy: spec.exportedBy ?? 'user-a',
            exportedAt: '2026-10-01T12:00:00.000Z',
            inspections: spec.inspections,
            ...spec.manifest,
        }),
        'outbox.json': enc(spec.outbox ?? []),
        'media/index.json': enc((spec.media ?? []).map(({ pendingId, inspectionId, contentType }) => ({ pendingId, inspectionId, contentType }))),
    };
    for (const [id, bytes] of Object.entries(spec.yjs ?? {})) files[`yjs/${id}.bin`] = bytes;
    for (const m of spec.media ?? []) {
        files[`media/${m.pendingId}.${m.ext ?? extensionFor(m.contentType)}`] = m.bytes ?? JPEG_BYTES;
    }
    Object.assign(files, spec.extra);
    return zipSync(files);
}

function centralEntryOffset(out: Uint8Array, name: string): number {
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
    let eocd = out.length - 22;
    while (eocd >= 0 && view.getUint32(eocd, true) !== 0x06054b50) eocd--;
    if (eocd < 0) throw new Error('not a zip archive');
    let at = view.getUint32(eocd + 16, true);
    for (let i = view.getUint16(eocd + 8, true); i > 0; i--) {
        const nameLength = view.getUint16(at + 28, true);
        if (new TextDecoder().decode(out.subarray(at + 46, at + 46 + nameLength)) === name) return at;
        at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    }
    throw new Error(`no entry named ${name}`);
}

/**
 * Rewrites the uncompressed size a zip declares for one entry, in the central
 * directory and in the local header, leaving the entry's bytes alone. This is
 * what a package that lies about an entry's size looks like. Returns a copy.
 */
export function declareEntrySize(zip: Uint8Array, name: string, declared: number): Uint8Array {
    const out = new Uint8Array(zip);
    const view = new DataView(out.buffer);
    const at = centralEntryOffset(out, name);
    view.setUint32(at + 24, declared, true);
    view.setUint32(view.getUint32(at + 42, true) + 22, declared, true);
    return out;
}

/**
 * Points the directory entry `alias` at the same local header, and so the same
 * compressed bytes, as `target`. Both entries must have been built from the same
 * content so their sizes agree; the result is an archive in which two names share
 * one stream. Returns a copy.
 */
export function aliasEntryData(zip: Uint8Array, alias: string, target: string): Uint8Array {
    const out = new Uint8Array(zip);
    const view = new DataView(out.buffer);
    view.setUint32(centralEntryOffset(out, alias) + 42, view.getUint32(centralEntryOffset(out, target) + 42, true), true);
    return out;
}
