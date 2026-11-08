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

export interface StateExport {
    /** Base64 of the encoded Y.Doc, or null when the object holds no document. */
    ydoc:      string | null;
    identity:  TransferIdentity | null;
    snapshots: unknown[];
}

export interface ParsedStateImport { bytes: Uint8Array; identity: TransferIdentity; snapshots: unknown[] }

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
export function parseStateImport(body: unknown): ParsedStateImport | null {
    if (typeof body !== 'object' || body === null) return null;
    const { ydoc, identity, snapshots } = body as { ydoc?: unknown; identity?: unknown; snapshots?: unknown };
    if (typeof ydoc !== 'string' || !ydoc) return null;
    const id = identity as TransferIdentity | null | undefined;
    if (!id || typeof id.tenantId !== 'string' || typeof id.inspectionId !== 'string') return null;
    return { bytes: base64ToBytes(ydoc), identity: id, snapshots: Array.isArray(snapshots) ? snapshots : [] };
}

/** `not-empty` when the target already holds a document: nothing is written. */
export async function writeImportedState(storage: DurableObjectStorage, keys: StateKeys, v: ParsedStateImport): Promise<'written' | 'not-empty'> {
    if ((await storage.get(keys.ydoc)) !== undefined) return 'not-empty';
    await storage.put(keys.ydoc, v.bytes);
    await storage.put(keys.identity, v.identity);
    if (v.snapshots.length > 0) await storage.put(keys.snapshots, v.snapshots);
    return 'written';
}
