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
