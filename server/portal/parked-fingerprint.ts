/**
 * What a parked command row holds: a FINGERPRINT, never the payload (#276).
 *
 * `cmd.tenant.update` carries `adminEmail` + `adminPasswordHash` SPARSELY —
 * only password-change commands do (see `applyCredentialIfFresh`). Parking the
 * message therefore wrote an admin credential into a table nothing pruned, no
 * erasure rule covered, and no PII heuristic flagged: `envelope` and `reason`
 * look like nothing. Both parking paths did it — the raw string on a parse
 * failure, `JSON.stringify(env)` on an unknown type/version.
 *
 * The table exists so a human learns that portal and core disagree about a
 * command shape. That question is answered by WHICH command, WHICH version,
 * WHERE in the tenant sequence, HOW BIG it was, WHETHER the bytes match what
 * the sender recorded, and — when it would not parse — WHICH envelope fields
 * were wrong. None of those is the payload.
 *
 * The fields below are an ALLOW-LIST read through primitive type guards, not a
 * redaction pass over the message: a field added to `data` tomorrow is dropped
 * because nothing reads it, not because someone remembered to name it.
 */
import { cmdEnvelopeIssueFields, type CmdEnvelope } from '../lib/sync-events/cmd-envelope';

/** Longest echoed string. The claimed `type`/`dataschema` on an unparseable
 *  message are attacker-shaped input; the real values are far shorter. */
const MAX_ECHOED = 200;

export interface ParkedFingerprint {
    /** Format marker — a reader must be able to tell a fingerprint from a
     *  pre-#276 raw envelope without guessing. */
    v: 1;
    type: string | null;
    dataschema: string | null;
    cmdId: string | null;
    tenantseq: number | null;
    /** Size of the message as received. A skew often shows up as a size jump. */
    bytes: number;
    /** Digest of the exact bytes, so the row can be matched against the
     *  sender's own record of what it published — the one question the payload
     *  could answer that the routing fields cannot. Not reversible, and not
     *  guessable: every envelope carries a UUID. */
    sha256: string;
    /** Envelope field names that failed validation. Parse failures only. */
    invalidFields?: string[];
}

function safeStringify(value: unknown): string {
    try { return JSON.stringify(value) ?? String(value); } catch { return String(value); }
}

async function sha256Hex(input: string): Promise<string> {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
    return [...new Uint8Array(buf)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function echoString(source: Record<string, unknown>, key: string): string | null {
    const value = source[key];
    return typeof value === 'string' ? value.slice(0, MAX_ECHOED) : null;
}

/** Routing fields a message CLAIMS when it did not parse. Read one by one and
 *  type-guarded, so a nested object under `type` cannot smuggle content out. */
function claimedFields(text: string): Pick<ParkedFingerprint, 'type' | 'dataschema' | 'cmdId' | 'tenantseq'> {
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { parsed = null; }
    if (parsed === null || typeof parsed !== 'object') {
        return { type: null, dataschema: null, cmdId: null, tenantseq: null };
    }
    const record = parsed as Record<string, unknown>;
    const seq = record['tenantseq'];
    return {
        type: echoString(record, 'type'),
        dataschema: echoString(record, 'dataschema'),
        cmdId: echoString(record, 'id'),
        tenantseq: typeof seq === 'number' && Number.isFinite(seq) ? seq : null,
    };
}

/**
 * Build the value written to `parked_cmd_events.envelope`. `parsed` is the
 * validated envelope when there is one (unknown type/version) and null when
 * there is not (parse failure); `raw` is the message exactly as delivered.
 */
export async function parkedFingerprint(raw: unknown, parsed: CmdEnvelope | null): Promise<string> {
    const text = typeof raw === 'string' ? raw : safeStringify(raw);
    const base = { v: 1 as const, bytes: text.length, sha256: await sha256Hex(text) };
    const fingerprint: ParkedFingerprint = parsed
        ? {
            ...base,
            type: parsed.type,
            dataschema: parsed.dataschema,
            cmdId: parsed.id,
            tenantseq: parsed.tenantseq,
        }
        : { ...base, ...claimedFields(text), invalidFields: cmdEnvelopeIssueFields(raw) };
    return JSON.stringify(fingerprint);
}
