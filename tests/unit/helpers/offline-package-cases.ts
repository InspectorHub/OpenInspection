/**
 * Packages for the shared import logic's specs, and an independent reader of
 * them. The reader is the ENGINE's own: the zip reader and schemas the import
 * endpoint runs, plus the cross-entry rules of its validation phase. A spec that
 * asks "is this part a package the engine accepts" asks this, not the code under
 * test.
 */
import { zipSync } from 'fflate';
import { MediaIndexSchema, OfflinePackageManifestSchema, OutboxSchema } from '@core/offline-package';
import { listPackage, readPackageEntry, verifyPackageEntries } from '../../../server/lib/native/offline-zip';
import { buildPackage, type PackageMedia, type PackageOutboxEntry } from './offline-package-fixture';

export const inspectionId = (index: number): string => `insp-${index}`;
export const photoId = (index: number, n: number): string => `ph-${index}-${n}`;

export interface CaseSpec {
    inspections: number;
    /** Indexes of inspections the package creates. */
    creates?: readonly number[];
    /** Photos per inspection index. */
    photos?: Readonly<Record<number, number>>;
    /** Queued updates per inspection index. */
    updates?: Readonly<Record<number, number>>;
    yjsBytes?: number;
    photoBytes?: number;
}

/** Deterministic bytes that differ per seed, so a part holding the wrong photo is visible. */
export function bytesFor(seed: string, length: number): Uint8Array {
    let state = 2166136261;
    for (let i = 0; i < seed.length; i++) state = Math.imul(state ^ seed.charCodeAt(i), 16777619) >>> 0;
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        out[i] = state >>> 24;
    }
    return out;
}

export function makeCase(spec: CaseSpec, extra?: Record<string, Uint8Array>): { zip: Uint8Array; ids: string[] } {
    const ids: string[] = [];
    const outbox: PackageOutboxEntry[] = [];
    const media: PackageMedia[] = [];
    const yjs: Record<string, Uint8Array> = {};
    for (let i = 0; i < spec.inspections; i++) {
        const id = inspectionId(i);
        ids.push(id);
        yjs[id] = bytesFor(`yjs-${id}`, spec.yjsBytes ?? 128);
        if (spec.creates?.includes(i)) outbox.push({ idempotencyKey: `k-create-${id}`, op: 'inspection.create', payload: { id, address: `${i} Main St` } });
        for (let j = 0; j < (spec.updates?.[i] ?? 0); j++) {
            outbox.push({ idempotencyKey: `k-update-${id}-${j}`, op: 'inspection.update', payload: { id, title: `title ${j}` } });
        }
        for (let n = 0; n < (spec.photos?.[i] ?? 0); n++) {
            media.push({ pendingId: photoId(i, n), inspectionId: id, contentType: 'image/jpeg', bytes: bytesFor(`photo-${i}-${n}`, spec.photoBytes ?? 256) });
        }
    }
    const zip = buildPackage({ tenantId: 'tenant-1', inspections: ids.map((id, i) => ({ id, reportId: `rep-${i}` })), yjs, outbox, media, ...(extra ? { extra } : {}) });
    return { zip, ids };
}

/** What the engine reads out of a package it accepts. */
export interface EngineView {
    ids: string[];
    yjs: Map<string, Uint8Array>;
    /** Idempotency keys of the queued writes, by inspection. */
    writes: Map<string, string[]>;
    /** Pending ids of the photos, by inspection. */
    photos: Map<string, string[]>;
    photoBytes: Map<string, Uint8Array>;
}

export type EngineVerdict = { ok: true; view: EngineView } | { ok: false; reason: string };

/** The ENGINE's reading of a package: its zip reader, its schemas, its cross-entry rules. */
export function engineReads(zip: Uint8Array): EngineVerdict {
    const listing = listPackage(zip);
    if (!listing.ok) return { ok: false, reason: listing.reason };
    const mismatched = verifyPackageEntries(zip, listing.entries);
    if (mismatched) return { ok: false, reason: `entry ${mismatched} does not match its declared size` };

    const json = (name: string): unknown => {
        const size = listing.entries.get(name);
        if (size === undefined) return undefined;
        const bytes = readPackageEntry(zip, name, size);
        return bytes ? JSON.parse(new TextDecoder().decode(bytes)) : undefined;
    };
    const manifest = OfflinePackageManifestSchema.safeParse(json('manifest.json'));
    if (!manifest.success) return { ok: false, reason: 'manifest is invalid' };
    const outbox = OutboxSchema.safeParse(json('outbox.json') ?? []);
    if (!outbox.success) return { ok: false, reason: 'outbox is invalid' };
    const media = MediaIndexSchema.safeParse(json('media/index.json') ?? []);
    if (!media.success) return { ok: false, reason: 'media index is invalid' };

    const ids = manifest.data.inspections.map((i) => i.id);
    const declared = new Set(ids);
    for (const e of outbox.data) if (!declared.has(e.payload.id)) return { ok: false, reason: 'outbox names an inspection outside the manifest' };
    for (const m of media.data) if (!declared.has(m.inspectionId)) return { ok: false, reason: 'media index names an inspection outside the manifest' };

    const yjs = new Map<string, Uint8Array>();
    const yjsNames = new Set([...listing.entries.keys()].filter((n) => n.startsWith('yjs/')));
    for (const id of ids) {
        const name = `yjs/${id}.bin`;
        if (!yjsNames.delete(name)) return { ok: false, reason: `no Yjs state for inspection ${id}` };
        yjs.set(id, readPackageEntry(zip, name, listing.entries.get(name)!)!);
    }
    if (yjsNames.size > 0) return { ok: false, reason: 'yjs entries name an inspection outside the manifest' };

    const files = new Set([...listing.entries.keys()].filter((n) => n.startsWith('media/') && n !== 'media/index.json'));
    const photoBytes = new Map<string, Uint8Array>();
    const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic' } as const;
    for (const m of media.data) {
        const name = `media/${m.pendingId}.${ext[m.contentType]}`;
        if (!files.delete(name)) return { ok: false, reason: `photo ${m.pendingId} is missing or does not match its declared type` };
        photoBytes.set(m.pendingId, readPackageEntry(zip, name, listing.entries.get(name)!)!);
    }
    if (files.size > 0) return { ok: false, reason: 'a photo has no media index entry' };

    const writes = new Map<string, string[]>(ids.map((id) => [id, []]));
    for (const e of outbox.data) writes.get(e.payload.id)!.push(e.idempotencyKey);
    const photos = new Map<string, string[]>(ids.map((id) => [id, []]));
    for (const m of media.data) photos.get(m.inspectionId)!.push(m.pendingId);
    return { ok: true, view: { ids, yjs, writes, photos, photoBytes } };
}

/** The view of a package the engine must accept. Fails the spec, naming the reason, when it does not. */
export function mustBeValid(zip: Uint8Array): EngineView {
    const verdict = engineReads(zip);
    if (!verdict.ok) throw new Error(`the engine would refuse this package: ${verdict.reason}`);
    return verdict.view;
}

/** A package whose archive holds an entry name the engine does not know. */
export function withExtraEntry(spec: CaseSpec, name = 'notes/readme.txt'): Uint8Array {
    return makeCase(spec, { [name]: new Uint8Array([1, 2, 3]) }).zip;
}

/**
 * A copy of `zip` with the first stored byte of one entry overwritten by 0xff,
 * which is not a valid start of a deflate block (and changes a stored entry's
 * content). The directory is untouched, so the archive still lists the entry.
 */
export function corruptEntryData(zip: Uint8Array, name: string): Uint8Array {
    const out = new Uint8Array(zip);
    const view = new DataView(out.buffer);
    let eocd = out.length - 22;
    while (view.getUint32(eocd, true) !== 0x06054b50) eocd--;
    let at = view.getUint32(eocd + 16, true);
    for (let i = view.getUint16(eocd + 8, true); i > 0; i--) {
        const nameLength = view.getUint16(at + 28, true);
        if (new TextDecoder().decode(out.subarray(at + 46, at + 46 + nameLength)) === name) {
            const local = view.getUint32(at + 42, true);
            out[local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)] = 0xff;
            return out;
        }
        at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    }
    throw new Error(`no entry named ${name}`);
}

/** A package with no manifest at all. */
export function withoutManifest(): Uint8Array {
    return zipSync({ 'outbox.json': new TextEncoder().encode('[]'), 'media/index.json': new TextEncoder().encode('[]') });
}

/** A package whose media index names an inspection the manifest does not. */
export function withOrphanPhoto(): Uint8Array {
    return buildPackage({
        tenantId: 'tenant-1',
        inspections: [{ id: inspectionId(0), reportId: 'rep-0' }],
        yjs: { [inspectionId(0)]: bytesFor('y', 16) },
        media: [{ pendingId: 'ph-x', inspectionId: 'insp-elsewhere', contentType: 'image/jpeg', bytes: bytesFor('x', 32) }],
    });
}

/** A package with no Yjs state for its one inspection. */
export function withoutYjs(): Uint8Array {
    return buildPackage({ tenantId: 'tenant-1', inspections: [{ id: inspectionId(0), reportId: 'rep-0' }] });
}
