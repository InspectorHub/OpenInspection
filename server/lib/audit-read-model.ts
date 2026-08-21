import type { AuditAction } from './audit';
import type { AuditFamily } from './audit-families';
import { AUDIT_REGISTRY, SUPERSEDED_ACTIONS, type MetaRole } from './audit-registry';
import { ERASED_SENTINEL } from './compliance/anonymize-pii';
import type { EsignAuditLog } from './db/schema/esign';

/**
 * One projection over the two audit tables, which must stay two tables.
 *
 * `audit_logs` is the activity trail: erasable in place, swept on a clock, no
 * integrity guarantee beyond the database. `esign_audit_logs` is a hash-chained,
 * Ed25519-signed evidence chain that is never swept. Their retention
 * obligations are mutually exclusive, so merging the STORAGE is not available;
 * what a reader wants is one list, and that is what this file produces.
 *
 * The projection therefore says, on every entry, which of the two it came from
 * and what integrity it actually carries. An entry that did not declare that
 * would let a plain row inherit a chain's credibility by sitting next to one.
 */

/** A value that is one of `T`, or any other string, without losing completion on `T`. */
type Known<T extends string> = T | (string & {});

export interface ActivityRow {
    id: string;
    /** `timestamp_ms`, so a bare number is epoch MILLISECONDS. */
    createdAt: Date | number | string;
    action: string;
    entityType: string;
    entityId: string | null;
    userId: string | null;
    /** Joined from `users.name`; null when the join found nothing. */
    actorName: string | null;
    metadata: Record<string, unknown> | null;
}

export interface EsignRow {
    id: string;
    createdAt: Date | number | string;
    event: Known<EsignAuditLog['event']>;
    requestId: string;
    payloadJson: string;
}

/**
 * Four states, and the reason they are four rather than "name or nothing".
 *
 * `anonymized` and `unrecorded` look identical in a row (no usable name) and
 * mean opposite things: one says a person was recorded and later erased on
 * purpose, the other says nobody was ever recorded. Collapsing them turns a
 * completed erasure into an apparent gap in the trail.
 */
export type AuditActor =
    | { kind: 'user'; id: string; name: string }
    | { kind: 'anonymized' }
    | { kind: 'system' }
    | { kind: 'unrecorded' };

export interface AuditEntry {
    id: string;
    /** Epoch milliseconds. */
    at: number;
    source: 'activity' | 'esign';
    family: Known<AuditFamily>;
    action: Known<AuditAction>;
    /**
     * Whether `action` is in `AUDIT_REGISTRY`. Rows outlive vocabulary: a name
     * deleted from the union is still sitting in the table, and dropping such a
     * row would silently shorten the trail. It is surfaced instead, flagged.
     */
    known: boolean;
    actor: AuditActor;
    subject: { family: Known<AuditFamily>; id: string } | null;
    /**
     * Metadata normalised by ROLE rather than by the key each emitter happened
     * to use, so `agentEmail`, `clientEmail`, `recipient` and `recipientEmail`
     * all read the same. Where an action passes two keys with the same role
     * (`feeCents` and `refundCents` are both counts), the later key wins — the
     * roles are a rendering vocabulary, not a lossless encoding, and anything
     * that needs both reads the row.
     */
    facts: Partial<Record<MetaRole, unknown>>;
    integrity: 'signed-chain' | 'plain';
}

/**
 * Actions the platform writes with no acting user, by design.
 *
 * Deliberately NOT "userId is null implies system". A null actor on an action a
 * person performs means the actor column was lost, and calling that "the system
 * did it" invents an explanation for missing data. Only actions whose call
 * sites pass no actor at all are listed: the booking fulfilment runs on a
 * public request (`services/booking/fulfill-booking.ts`), and the agent
 * magic-login code is issued to someone who has no session yet
 * (`services/agent/magic-login.service.ts`).
 */
const SYSTEM_WRITTEN: ReadonlySet<string> = new Set([
    'booking.routing.applied',
    'agent.magic_login.issued',
]);

/**
 * Chain events that also exist in the `audit_logs` vocabulary, mapped onto it.
 *
 * The two vocabularies genuinely differ, and the gaps are left as gaps:
 * `agreement.signed`, `signer.signed` and `workflow.complete` have no
 * `audit_logs` counterpart, and inventing one would put a name in the read
 * model that `audit_logs` has never held. Those keep their own event name and
 * report `known: false`.
 */
const ESIGN_EVENT_TO_ACTION: Readonly<Record<string, AuditAction>> = {
    'request.created': 'agreement.create',
    'request.sent': 'agreement.sent',
    'request.viewed': 'agreement.viewed',
    'signer.presented': 'agreement.viewed',
    'signer.declined': 'agreement.declined',
    'signer.reminded': 'agreement.remind',
    'agreement.inspector_signed': 'agreement.inspector_signed',
};

/**
 * Epoch milliseconds from whatever D1 handed back.
 *
 * Not `safeTimestamp` from `lib/date`: that helper reads a bare number as
 * SECONDS, and both `audit_logs.created_at` and `esign_audit_logs.created_at`
 * are `timestamp_ms`. Passing one through it would move every row a thousandfold
 * into the future, and nothing downstream would notice.
 */
function toMillis(v: Date | number | string): number {
    if (v instanceof Date) return v.getTime();
    if (typeof v === 'number') return v;
    const parsed = new Date(v.includes('T') ? v : `${v}Z`);
    return parsed.getTime();
}

function resolveAction(raw: string): { action: string; known: boolean } {
    const action = SUPERSEDED_ACTIONS[raw] ?? raw;
    return { action, known: action in AUDIT_REGISTRY };
}

function projectFacts(action: string, metadata: Record<string, unknown> | null): Partial<Record<MetaRole, unknown>> {
    const def = AUDIT_REGISTRY[action as AuditAction];
    if (!def || !metadata) return {};
    const facts: Partial<Record<MetaRole, unknown>> = {};
    for (const [key, value] of Object.entries(metadata)) {
        const role = def.meta[key];
        // An undeclared key is dropped rather than guessed at. The registry is
        // the contract for what a row carries; a key it does not name is either
        // new (and the gate will say so on the next run) or gone.
        if (role) facts[role] = value;
    }
    return facts;
}

function projectActor(row: ActivityRow, action: string): AuditActor {
    if (row.actorName === ERASED_SENTINEL) return { kind: 'anonymized' };
    if (row.userId) return { kind: 'user', id: row.userId, name: row.actorName ?? '' };
    if (SYSTEM_WRITTEN.has(action)) return { kind: 'system' };
    return { kind: 'unrecorded' };
}

/** Project one `audit_logs` row. */
export function fromActivityRow(row: ActivityRow): AuditEntry {
    const { action, known } = resolveAction(row.action);
    return {
        id: row.id,
        at: toMillis(row.createdAt),
        source: 'activity',
        family: row.entityType,
        action,
        known,
        actor: projectActor(row, action),
        subject: row.entityId ? { family: row.entityType, id: row.entityId } : null,
        facts: projectFacts(action, row.metadata),
        integrity: 'plain',
    };
}

/**
 * Project one `esign_audit_logs` row.
 *
 * The actor is reported as `unrecorded` and that is deliberate, not an
 * omission: the chain has no actor column, the identity lives inside
 * `payload_json`, and that payload is the signed evidence. Paraphrasing a
 * signed blob into a projection is how a chain-backed fact quietly loses its
 * chain — a reader who needs the signer opens the payload, where the signature
 * still covers it.
 */
export function fromEsignRow(row: EsignRow): AuditEntry {
    const mapped = ESIGN_EVENT_TO_ACTION[row.event];
    const action = mapped ?? row.event;
    return {
        id: row.id,
        at: toMillis(row.createdAt),
        source: 'esign',
        family: 'agreement_request',
        action,
        known: action in AUDIT_REGISTRY,
        actor: { kind: 'unrecorded' },
        subject: { family: 'agreement_request', id: row.requestId },
        facts: {},
        integrity: 'signed-chain',
    };
}
