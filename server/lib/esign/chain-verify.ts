/**
 * Checking an exported audit trail without the server: the logic behind the offline verifier page.
 *
 * It restates, with the browser's WebCrypto and nothing else, what `AuditLogService.verifyChain` checks on the server, and it must stay the
 * same rule set (tests/unit/esign/chain-verify.spec.ts builds chains with the real service and feeds them here):
 *
 *   - a row's hash is SHA-256 of its `payloadJson` followed by its `prevHash` (nothing when it has none), written as hex;
 *   - its signature is Ed25519, base64url encoded, over the BYTES the hex hash stands for (not over the hex text);
 *   - it is checked against the key named by its own `keyFingerprint`, so a chain that spans a key rotation verifies as long as the pack
 *     carries every key the chain used;
 *   - rows form one line: the first has no predecessor (`null`; an empty string is NOT "no predecessor") and each later one names the
 *     hash of the row before it. The rows are followed by those links, not by the order they happen to be listed in, so a pack that lists
 *     them in any order still verifies, and two rows with one predecessor (a fork) are reported.
 *
 * What the pack itself cannot prove: a key it carries is only as good as the fingerprint the reader compares it with. So every key's
 * fingerprint is RECOMPUTED here (SHA-256 of the key's SPKI bytes, as the server computes it) and must equal the one the pack claims; the
 * fingerprints that were used are returned so the page can show them next to the one on the online verification page.
 *
 * A key the pack does not carry is reported as exactly that (`no_key`), never as a bad signature: we could not check, which is not the
 * same finding as a signature that failed to verify. Not detected, by design: a pack cut short at the END is a valid chain; the event
 * count on the online record is the check for that.
 */

export interface PackEvent {
    id: string;
    event: string;
    payloadJson: string;
    prevHash: string | null;
    hash: string;
    signature: string;
    keyFingerprint: string;
}

export interface PackKey { fingerprint: string; pem: string }

type ChainProblemReason = 'chain' | 'fork' | 'hash' | 'signature' | 'no_key' | 'bad_key' | 'key_mismatch' | 'empty';

export interface ChainProblem { reason: ChainProblemReason; eventId?: string; detail?: string }

export interface ChainVerdict {
    problems: ChainProblem[];
    /** Fingerprints (recomputed from the key material) of the keys that checked at least one event. */
    fingerprintsUsed: string[];
}

function bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array | null {
    if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) return null;
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return out;
}

function base64UrlToBytes(value: string): Uint8Array | null {
    try {
        const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
        const bin = atob(padded);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
        return out;
    } catch {
        return null;
    }
}

function pemToDer(pem: string): Uint8Array {
    const body = pem.replace(/-----BEGIN [^-]+-----/, '').replace(/-----END [^-]+-----/, '').replace(/\s/g, '');
    const bin = atob(body);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
}

async function sha256Hex(text: string): Promise<string> {
    return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))));
}

/** The rows in chain order, plus the problems found while ordering them. Linear in the number of rows. */
function orderByLinks(events: readonly PackEvent[]): { ordered: PackEvent[]; problems: ChainProblem[] } {
    const problems: ChainProblem[] = [];
    // Rows are tracked by OBJECT identity, never by `id`: a forged row may copy another row's id.
    const reported = new Set<PackEvent>();
    const report = (ev: PackEvent, problem: ChainProblem): void => {
        reported.add(ev);
        problems.push(problem);
    };
    const firstOfId = new Map<string, PackEvent>();
    for (const ev of events) {
        if (firstOfId.has(ev.id)) report(ev, { reason: 'chain', eventId: ev.id, detail: 'two events share one id' });
        else firstOfId.set(ev.id, ev);
    }
    // `null` (no predecessor) and a string (including '') are different things: only a row with NO predecessor can start the chain.
    const heads: PackEvent[] = [];
    const byPrev = new Map<string, PackEvent[]>();
    for (const ev of events) {
        if (ev.prevHash === null) { heads.push(ev); continue; }
        const rows = byPrev.get(ev.prevHash);
        if (rows) rows.push(ev); else byPrev.set(ev.prevHash, [ev]);
    }
    heads.slice(1).forEach((ev) => report(ev, { reason: 'fork', eventId: ev.id, detail: 'a second first event' }));
    for (const [prev, rows] of byPrev) {
        if (rows.length > 1) rows.slice(1).forEach((ev) => report(ev, { reason: 'fork', eventId: ev.id, detail: `two events follow the event ${prev.slice(0, 12)}` }));
    }
    const ordered: PackEvent[] = [];
    const seen = new Set<PackEvent>();
    let next: PackEvent | undefined = heads[0];
    while (next && !seen.has(next)) {
        ordered.push(next);
        seen.add(next);
        next = byPrev.get(next.hash)?.[0];
    }
    // Every input row ends up either in the chain (and so verified below) or reported here: rows the links never reach hang off an event
    // that is not in the pack, or sit behind a fork or a loop.
    for (const ev of events) if (!seen.has(ev) && !reported.has(ev)) report(ev, { reason: 'chain', eventId: ev.id, detail: 'not linked to the first event' });
    return { ordered, problems };
}

/** Every problem found in a pack's events, given the keys the pack carries, and the fingerprints that did the checking. */
export async function verifyEvidenceChainDetailed(events: readonly PackEvent[], keys: readonly PackKey[]): Promise<ChainVerdict> {
    if (events.length === 0) return { problems: [{ reason: 'empty' }], fingerprintsUsed: [] };
    const { ordered, problems } = orderByLinks(events);

    // A key is trusted only if the fingerprint it is filed under is the fingerprint of its own bytes.
    const imported = new Map<string, { key: CryptoKey | null; actual: string }>();
    for (const claimed of keys) {
        try {
            const der = pemToDer(claimed.pem);
            const actual = bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', der as unknown as ArrayBuffer)));
            if (actual !== claimed.fingerprint) {
                imported.set(claimed.fingerprint, { key: null, actual });
                problems.push({ reason: 'key_mismatch', detail: claimed.fingerprint });
                continue;
            }
            imported.set(claimed.fingerprint, { key: await crypto.subtle.importKey('spki', der as unknown as ArrayBuffer, { name: 'Ed25519' }, false, ['verify']), actual });
        } catch (e) {
            imported.set(claimed.fingerprint, { key: null, actual: claimed.fingerprint });
            problems.push({ reason: 'bad_key', detail: `${claimed.fingerprint}: ${e instanceof Error ? e.message : String(e)}` });
        }
    }

    const used = new Set<string>();
    for (const ev of ordered) {
        const expected = await sha256Hex(ev.payloadJson + (ev.prevHash ?? ''));
        if (expected !== ev.hash) {
            problems.push({ reason: 'hash', eventId: ev.id });
            continue;
        }
        const entry = imported.get(ev.keyFingerprint);
        if (entry === undefined) {
            problems.push({ reason: 'no_key', eventId: ev.id, detail: ev.keyFingerprint });
            continue;
        }
        if (entry.key === null) continue; // already reported as key_mismatch or bad_key
        const signature = base64UrlToBytes(ev.signature);
        const hashBytes = hexToBytes(ev.hash);
        const ok = signature !== null && hashBytes !== null
            && await crypto.subtle.verify({ name: 'Ed25519' }, entry.key, signature as unknown as ArrayBuffer, hashBytes as unknown as ArrayBuffer);
        if (ok) used.add(entry.actual); else problems.push({ reason: 'signature', eventId: ev.id });
    }
    return { problems, fingerprintsUsed: [...used] };
}
