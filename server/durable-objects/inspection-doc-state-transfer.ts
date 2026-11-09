/**
 * The Durable Object's `/state-export` and `/state-import` verbs.
 *
 * A jurisdiction-pinned object has a different id from the unpinned one with the same name (see
 * `server/lib/collab/do-jurisdiction.ts`), so its stored state is copied across once: content, identity and restore points.
 * Reached only through a Worker-side stub whose id is derived from the verified tenant and report.
 *
 * Import never merges. A target that holds ANY state (a document, an identity, restore points) or whose in-memory document is
 * already live is refused with a reason code. The single exception is an explicit `replaceDerived` request, honoured only for
 * a target that is not live, carries the stored identity of the same document, and still bears the `derived-from-d1` marker:
 * the object sets that marker when it built its document from the database and clears it on the first later change, so a
 * target that any client has edited can never be replaced.
 *
 * The body is fully validated (base64, a Yjs update that applies cleanly, the one expected top-level shape, restore points of
 * the shape the object itself writes) before the first write, and the write is a single atomic storage put, so a refused or
 * crashed import leaves the object exactly as it was.
 */

import * as Y from 'yjs';
import { isGeneration, newGeneration, storedGeneration } from './inspection-doc-generation';

/** The only top-level type a results document has (see `getMap('results')` in the Durable Object). */
const RESULTS_ROOT = 'results';

/** The most restore points the object keeps (its own cap), and the most text one import may carry for them. */
const MAX_SNAPSHOTS = 25;
const MAX_SNAPSHOT_JSON_CHARS = 2_000_000;
const SNAPSHOT_REASONS: readonly string[] = ['periodic', 'manual', 'connect', 'import', 'pre-rename'];

export interface StateKeys { ydoc: string; identity: string; snapshots: string; derived: string; backup: string; gen: string }

/** The document a replacement displaced, kept so the replacement can be undone (see `/state-restore-backup`). */
interface ReplacedBackup {
    ydoc:      Uint8Array;
    /** Digest of the displaced document. */
    sha256:    string;
    /** Digest of the replacement that displaced it: a restore is only honoured while the replacement is still exactly that. */
    newSha256: string;
    atMs:      number;
    /** Generation (lineage id) of the displaced document; absent in a backup written before generations existed. */
    gen?:      string;
}

export interface TransferIdentity { tenantId: string; inspectionId: string; reportId?: string | null }

/** A restore point as the object writes it (`captureSnapshot`); the projection itself is carried through untouched. */
export interface ImportedSnapshot {
    seq:        number;
    atMs:       number;
    byUserId:   string | null;
    reason?:    string;
    projection: object;
}

export interface StateExport {
    /** Base64 of the encoded Y.Doc, or null when the object holds no document. */
    ydoc:           string | null;
    identity:       TransferIdentity | null;
    snapshots:      ImportedSnapshot[];
    /** True while the document was built from the database and no client has changed it since. */
    derivedFromD1?: boolean;
    /** The lineage id of the document (see `inspection-doc-generation.ts`); null from an object that stored none. It travels with the bytes. */
    gen:            string | null;
}

/** A restore point as it arrives: any field may be missing or wrong, `parseStateImport` checks it. */
interface RawSnapshot {
    seq?:        number;
    atMs?:       number;
    byUserId?:   string | null;
    reason?:     string;
    projection?: object | null;
}

/** What an import body may carry. Every field is optional because the body comes from a caller: `parseStateImport` checks it. */
export interface StateImportBody {
    ydoc?:           string;
    identity?:       Partial<TransferIdentity> | null;
    snapshots?:      RawSnapshot[];
    /** Ask to replace a target that is still only what the database produced. Honoured only under the rules in the header. */
    replaceDerived?: boolean;
    /** The lineage id of the document, as exported. Absent or null (an older exporter) means a new one is minted. */
    gen?:            string | null;
}

/** What the transfer reads and writes in storage. */
export type StoredValue = Uint8Array | TransferIdentity | ImportedSnapshot[] | ReplacedBackup | boolean | string;

/** The two storage verbs the transfer needs. `DurableObjectStorage` satisfies it, and so does a test double. */
export interface TransferStorage {
    get(keys: string[]): Promise<Map<string, StoredValue>>;
    put(entries: Record<string, StoredValue>): Promise<void>;
}

export interface ParsedStateImport {
    bytes:          Uint8Array;
    identity:       TransferIdentity;
    snapshots:      ImportedSnapshot[];
    replaceDerived: boolean;
    /** The lineage id the imported document keeps: the source's, or a freshly minted one when the body carried none. */
    gen:            string;
}

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

async function sha256Hex(bytes: Uint8Array): Promise<string> {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

function storedIdentity(v: StoredValue | undefined): TransferIdentity | null {
    return v && typeof v === 'object' && !(v instanceof Uint8Array) && !Array.isArray(v) && 'tenantId' in v ? v : null;
}

function storedBackup(v: StoredValue | undefined): ReplacedBackup | null {
    return v && typeof v === 'object' && !(v instanceof Uint8Array) && !Array.isArray(v) && 'sha256' in v ? v : null;
}

export async function exportStoredState(storage: TransferStorage, keys: StateKeys): Promise<StateExport> {
    const stored = await storage.get([keys.ydoc, keys.identity, keys.snapshots, keys.derived, keys.gen]);
    const ydoc = stored.get(keys.ydoc);
    const gen = stored.get(keys.gen);
    const snapshots = stored.get(keys.snapshots);
    return {
        ydoc:          ydoc instanceof Uint8Array ? bytesToBase64(ydoc) : null,
        identity:      storedIdentity(stored.get(keys.identity)),
        snapshots:     Array.isArray(snapshots) ? snapshots : [],
        derivedFromD1: stored.get(keys.derived) === true,
        gen:           typeof gen === 'string' ? storedGeneration(gen) : null,
    };
}

/** True when `bytes` is a complete Yjs update whose only top-level type is the results map. Applies to a scratch document, never the real one. */
function isResultsDocument(bytes: Uint8Array): boolean {
    try {
        const scratch = new Y.Doc();
        Y.applyUpdate(scratch, bytes);
        // An update that needs structs it does not carry is held back as pending: the document would be incomplete.
        if (scratch.store.pendingStructs !== null || scratch.store.pendingDs !== null) return false;
        for (const name of scratch.share.keys()) if (name !== RESULTS_ROOT) return false;
        // Array and text content hangs off `_start`; a map keeps its entries in `_map` only.
        return scratch.getMap(RESULTS_ROOT)._start === null;
    } catch {
        return false;
    }
}

function decodeBase64(s: string): Uint8Array | null {
    try { return base64ToBytes(s); } catch { return null; }
}

const isPlainObject = (v: object | null | undefined): v is object => typeof v === 'object' && v !== null && !Array.isArray(v);

function isSnapshot(s: RawSnapshot): s is ImportedSnapshot {
    return isPlainObject(s)
        && typeof s.seq === 'number' && Number.isFinite(s.seq)
        && typeof s.atMs === 'number' && Number.isFinite(s.atMs)
        && (s.byUserId === null || typeof s.byUserId === 'string')
        && (s.reason === undefined || SNAPSHOT_REASONS.includes(s.reason))
        && isPlainObject(s.projection);
}

function validSnapshots(snapshots: RawSnapshot[] | undefined): ImportedSnapshot[] | null {
    if (snapshots === undefined) return [];
    if (!Array.isArray(snapshots) || snapshots.length > MAX_SNAPSHOTS || !snapshots.every(isSnapshot)) return null;
    return JSON.stringify(snapshots).length > MAX_SNAPSHOT_JSON_CHARS ? null : snapshots;
}

/** Null when the body is not a usable export. Everything the write depends on is checked here, before any write. */
export function parseStateImport(body: StateImportBody | null): ParsedStateImport | null {
    if (!body || typeof body !== 'object') return null;
    const { ydoc, identity, snapshots, replaceDerived, gen } = body;
    if (typeof ydoc !== 'string' || !ydoc) return null;
    if (gen !== undefined && gen !== null && !isGeneration(gen)) return null;
    if (!identity || typeof identity.tenantId !== 'string' || !identity.tenantId || typeof identity.inspectionId !== 'string' || !identity.inspectionId) return null;
    const checked = validSnapshots(snapshots);
    if (!checked) return null;
    const bytes = decodeBase64(ydoc);
    if (!bytes || bytes.length === 0 || !isResultsDocument(bytes)) return null;
    const { tenantId, inspectionId, reportId } = identity;
    return {
        bytes,
        identity: reportId === undefined ? { tenantId, inspectionId } : { tenantId, inspectionId, reportId },
        snapshots: checked,
        replaceDerived: replaceDerived === true,
        gen: gen ?? newGeneration(),
    };
}

export type ImportRefusal = 'target-has-state' | 'target-live' | 'target-edited' | 'target-unsaved' | 'target-identity-mismatch';

/** Present when an existing target was replaced: sizes and hashes of both sides, for the audit line. */
export interface ReplacedTarget { previousBytes: number; previousSha256: string; newSha256: string }

export type ImportOutcome =
    | { status: 'imported'; parsed: ParsedStateImport; replaced: ReplacedTarget | null }
    | { status: 'invalid' }
    | { status: 'refused'; reason: ImportRefusal; targetBytes: number; targetSnapshots: number };

const sameIdentity = (a: TransferIdentity | null, b: TransferIdentity): boolean =>
    a !== null && a.tenantId === b.tenantId && a.inspectionId === b.inspectionId && (a.reportId ?? null) === (b.reportId ?? null);

/** The same bytes? Used to notice a target that changed while a digest was being computed. */
const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Validate, check the target, then write everything in ONE atomic put.
 *
 * Ordering matters: every `await` that is not a storage call (the digests) happens BEFORE the final storage read. After that
 * read nothing is awaited until the put is issued, so `live()`, the marker and the stored identity are judged on the very state
 * the put then replaces; the object's input gate holds other events off across the storage calls. `live()` is the caller's
 * word that sockets are open or changes are waiting to be stored: importing then would blend two documents. Refuses in every
 * case where the target is not provably empty, except an explicitly requested replacement of a still-derived target.
 */
export async function importState(storage: TransferStorage, keys: StateKeys, body: StateImportBody | null, live: () => boolean): Promise<ImportOutcome> {
    const parsed = parseStateImport(body);
    if (!parsed) return { status: 'invalid' };
    const read = () => storage.get([keys.ydoc, keys.identity, keys.snapshots, keys.derived, keys.gen]);
    // Digests first (only a replacement needs them), from a provisional read.
    let digests: { previous: string; next: string; previousBytes: Uint8Array } | null = null;
    if (parsed.replaceDerived) {
        const provisional = (await read()).get(keys.ydoc);
        if (provisional instanceof Uint8Array) digests = { previous: await sha256Hex(provisional), next: await sha256Hex(parsed.bytes), previousBytes: provisional };
    }
    // From here to the put: no await except the storage calls themselves.
    const held = await read();
    const heldDoc = held.get(keys.ydoc);
    const heldSnapshots = held.get(keys.snapshots);
    const targetBytes = heldDoc instanceof Uint8Array ? heldDoc.length : 0;
    const targetSnapshots = Array.isArray(heldSnapshots) ? heldSnapshots.length : 0;
    const refuse = (reason: ImportRefusal): ImportOutcome => ({ status: 'refused', reason, targetBytes, targetSnapshots });
    if (live()) return refuse('target-live');
    const hasState = [keys.ydoc, keys.identity, keys.snapshots].some((k) => held.has(k));
    let replaced: ReplacedTarget | null = null;
    // The lineage id goes in the same put as the bytes it names. A replacement keeps the SOURCE's: clients holding the source
    // history stay valid, clients that synced with the displaced database-built target (another id) are discarded on connect.
    const entries: Record<string, StoredValue> = { [keys.ydoc]: parsed.bytes, [keys.identity]: parsed.identity, [keys.gen]: parsed.gen };
    if (hasState) {
        if (!parsed.replaceDerived) return refuse('target-has-state');
        if (held.get(keys.derived) !== true) return refuse('target-edited');
        if (!(heldDoc instanceof Uint8Array)) return refuse('target-unsaved');
        if (!sameIdentity(storedIdentity(held.get(keys.identity)), parsed.identity)) return refuse('target-identity-mismatch');
        // The document the digests describe must still be the one stored.
        if (!digests || !sameBytes(digests.previousBytes, heldDoc)) return refuse('target-live');
        replaced = { previousBytes: heldDoc.length, previousSha256: digests.previous, newSha256: digests.next };
        entries[keys.snapshots] = parsed.snapshots;
        // The marker is cleared in the SAME put: the document now holds the source's history, not what the database produced.
        entries[keys.derived] = false;
        const heldGen = storedGeneration(typeof held.get(keys.gen) === 'string' ? String(held.get(keys.gen)) : null);
        entries[keys.backup] = { ydoc: heldDoc, sha256: digests.previous, newSha256: digests.next, atMs: Date.now(), ...(heldGen ? { gen: heldGen } : {}) };
    } else if (parsed.snapshots.length > 0) {
        entries[keys.snapshots] = parsed.snapshots;
    }
    await storage.put(entries);
    return { status: 'imported', parsed, replaced };
}

/** The backup of a replaced target, with its document, for an operator to compare before restoring. Changes nothing. */
async function readBackup(host: TransferHost): Promise<Response> {
    const backup = storedBackup((await host.storage.get([host.keys.backup])).get(host.keys.backup));
    if (!backup) return new Response('no backup', { status: 404 });
    return Response.json({ ydoc: bytesToBase64(backup.ydoc), sha256: backup.sha256, newSha256: backup.newSha256, atMs: backup.atMs });
}

/**
 * Undo a replacement: put the backed-up DOCUMENT back (only the document: the restore points stay the replacement's, and the
 * ones it displaced are gone), mark it database-built again (it is exactly what the object built), and
 * spend the backup. Honoured only while the stored document is still exactly the replacement (its digest equals the one the
 * backup recorded): once any client edit has persisted, restoring would discard that edit, so it is refused as `target-edited`.
 * Refused while the object is live, and 404 when there is nothing to restore. Same ordering rule as `importState`: the digest
 * is computed first, then the last read, `live()` and the put follow with nothing awaited between them.
 */
async function restoreBackup(host: TransferHost): Promise<Response> {
    const { storage, keys } = host;
    const read = () => storage.get([keys.backup, keys.identity, keys.ydoc]);
    const provisional = await read();
    const backup = storedBackup(provisional.get(keys.backup));
    if (!backup) return new Response('no backup', { status: 404 });
    const provisionalDoc = provisional.get(keys.ydoc);
    const currentSha = provisionalDoc instanceof Uint8Array ? await sha256Hex(provisionalDoc) : null;
    // From here to the put: no await except the storage calls themselves.
    const held = await read();
    const heldBackup = storedBackup(held.get(keys.backup));
    const heldDoc = held.get(keys.ydoc);
    if (!heldBackup) return new Response('no backup', { status: 404 });
    if (host.live()) return Response.json({ error: 'target-live' }, { status: 409 });
    if (!(heldDoc instanceof Uint8Array) || !(provisionalDoc instanceof Uint8Array) || !sameBytes(provisionalDoc, heldDoc) || currentSha !== heldBackup.newSha256) {
        return Response.json({ error: 'target-edited' }, { status: 409 });
    }
    // The displaced document's own lineage id goes back with it (a backup from before ids existed gets a new one).
    const gen = heldBackup.gen ?? newGeneration();
    await storage.put({ [keys.ydoc]: heldBackup.ydoc, [keys.derived]: true, [keys.backup]: false, [keys.gen]: gen });
    const identity = storedIdentity(held.get(keys.identity));
    if (identity) host.adopt({ bytes: heldBackup.ydoc, identity, snapshots: [], replaceDerived: false, gen }, true);
    return Response.json({ ok: true, bytes: heldBackup.ydoc.length, sha256: heldBackup.sha256 });
}

/** What the two verbs need from the object that owns them. */
export interface TransferHost {
    storage: TransferStorage;
    keys:    StateKeys;
    /** True when sockets are open or changes are waiting to be stored. */
    live(): boolean;
    /** Store what sockets have sent but the debounce has not yet persisted. */
    flush(): Promise<void>;
    /** Make the in-memory document and identity the imported ones. */
    adopt(imported: ParsedStateImport, derived: boolean): void;
}

/** Answers the two transfer verbs, or null when `pathname` is not one of them. */
export async function handleStateTransfer(req: Request, pathname: string, host: TransferHost): Promise<Response | null> {
    if (pathname.endsWith('/state-export') && req.method === 'GET') {
        await host.flush();
        return Response.json(await exportStoredState(host.storage, host.keys));
    }
    if (pathname.endsWith('/state-backup') && req.method === 'GET') return readBackup(host);
    if (pathname.endsWith('/state-restore-backup') && req.method === 'POST') return restoreBackup(host);
    if (!(pathname.endsWith('/state-import') && req.method === 'POST')) return null;
    const out = await importState(host.storage, host.keys, await req.json<StateImportBody | null>().catch(() => null), host.live);
    if (out.status === 'invalid') return new Response('invalid body', { status: 400 });
    if (out.status === 'refused') return Response.json({ error: 'target-not-empty', reason: out.reason, targetBytes: out.targetBytes, targetSnapshots: out.targetSnapshots }, { status: 409 });
    host.adopt(out.parsed, false);
    return Response.json({ ok: true, bytes: out.parsed.bytes.length, replaced: out.replaced });
}
