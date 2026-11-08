/**
 * The Durable Object's `/state-export` and `/state-import` verbs.
 *
 * A jurisdiction-pinned object has a different id from the unpinned one with the same name (see
 * `server/lib/collab/do-jurisdiction.ts`), so its stored state is copied across once: content, identity and restore points.
 * Reached only through a Worker-side stub whose id is derived from the verified tenant and report. Import never overwrites:
 * a target that already holds state is refused, so a repeat cannot replace newer edits.
 */

export interface StateKeys { ydoc: string; identity: string; snapshots: string }

export interface TransferIdentity { tenantId: string; inspectionId: string; reportId?: string | null }

/** Restore points are carried through untouched; this module never reads inside one. */
export type SnapshotRecord = object;

export interface StateExport {
    /** Base64 of the encoded Y.Doc, or null when the object holds no document. */
    ydoc:      string | null;
    identity:  TransferIdentity | null;
    snapshots: SnapshotRecord[];
}

/** What an import body may carry. Every field is optional because the body comes from a caller: `parseStateImport` checks it. */
export interface StateImportBody {
    ydoc?:      string;
    identity?:  Partial<TransferIdentity> | null;
    snapshots?: SnapshotRecord[];
}

export interface ParsedStateImport { bytes: Uint8Array; identity: TransferIdentity; snapshots: SnapshotRecord[] }

export function bytesToBase64(b: Uint8Array): string {
    let s = '';
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
    return btoa(s);
}

export function base64ToBytes(s: string): Uint8Array {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

export async function exportStoredState(storage: DurableObjectStorage, keys: StateKeys): Promise<StateExport> {
    const [ydoc, identity, snapshots] = await Promise.all([
        storage.get<Uint8Array>(keys.ydoc),
        storage.get<TransferIdentity>(keys.identity),
        storage.get(keys.snapshots),
    ]);
    return {
        ydoc:      ydoc instanceof Uint8Array ? bytesToBase64(ydoc) : null,
        identity:  identity ?? null,
        snapshots: Array.isArray(snapshots) ? snapshots : [],
    };
}

/** Null when the body is not a usable export. */
export function parseStateImport(body: StateImportBody | null): ParsedStateImport | null {
    if (!body || typeof body !== 'object') return null;
    const { ydoc, identity, snapshots } = body;
    if (typeof ydoc !== 'string' || !ydoc) return null;
    if (!identity || typeof identity.tenantId !== 'string' || typeof identity.inspectionId !== 'string') return null;
    const { tenantId, inspectionId, reportId } = identity;
    return { bytes: base64ToBytes(ydoc), identity: reportId === undefined ? { tenantId, inspectionId } : { tenantId, inspectionId, reportId }, snapshots: Array.isArray(snapshots) ? snapshots : [] };
}

/** `not-empty` when the target already holds a document: nothing is written. */
export async function writeImportedState(storage: DurableObjectStorage, keys: StateKeys, v: ParsedStateImport): Promise<'written' | 'not-empty'> {
    if ((await storage.get(keys.ydoc)) !== undefined) return 'not-empty';
    await storage.put(keys.ydoc, v.bytes);
    await storage.put(keys.identity, v.identity);
    if (v.snapshots.length > 0) await storage.put(keys.snapshots, v.snapshots);
    return 'written';
}
