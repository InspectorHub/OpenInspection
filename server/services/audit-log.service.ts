import { drizzle } from 'drizzle-orm/d1';
import { eq, and, desc, asc, sql, type SQL } from 'drizzle-orm';
import { esignAuditLogs } from '../lib/db/schema';
import { logger } from '../lib/logger';
import { Errors } from '../lib/errors';
import type { SigningKeyService} from './signing-key.service';
import { sha256Hex } from '../lib/sha256';
import { hexDecode, base64UrlDecode } from './signing-key.service';

export type AuditEvent =
    | 'request.created'
    | 'request.sent'
    | 'request.viewed'
    /**
     * THIS signer was presented the agreement, at this content hash.
     *
     * Deliberately `signer.`-prefixed, and that prefix is the whole reason this
     * event exists rather than reusing `request.viewed`. The dedup index below
     * excludes `signer.%` — so an envelope-level event can appear at most once,
     * while a per-signer event appears once per signer. A presentation is a
     * PER-SIGNER fact: on a two-signer envelope, `request.viewed` would insert
     * for the first viewer and then hit the constraint for the second, returning
     * the first signer's row. The chain would then show a presentation to
     * somebody else and the second signer's intent would rest on it.
     */
    | 'signer.presented'
    | 'agreement.signed'
    | 'agreement.inspector_signed'
    | 'signer.signed'
    | 'signer.declined'
    | 'signer.reminded'
    | 'workflow.complete';

/**
 * Optional guard on an append, evaluated in the same statement that writes the row (so two requests cannot both pass it): the row is not
 * written when the NEWEST row of this event for this signer already carries the same values for every key in `match` (and, when
 * `windowMs` is given, is newer than the window). The existing row is returned instead.
 *
 * It is the newest row that counts, not any earlier one: a signer whose rows read A, then B must not have A "found" again by a retry
 * with A, because the chain's last word about that signer would then no longer be the last thing recorded.
 */
export interface AppendOptions {
    dedupe?: { signerId: string; match?: Record<string, string | null>; windowMs?: number };
}

/** How many times an append retries after losing its position to another writer, before it gives up and says so. */
const MAX_APPEND_ATTEMPTS = 8;
/** Upper bound of the random pause before a retry, per attempt already lost (milliseconds). */
const RETRY_JITTER_MS = 12;

/** True for the database's unique-constraint failure, however the driver wraps it (the message may sit on a `cause`). */
function isUniqueViolation(err: unknown): boolean {
    for (let e: unknown = err, depth = 0; e && depth < 4; depth += 1) {
        const message = e instanceof Error ? e.message : String(e);
        if (/UNIQUE constraint failed/i.test(message)) return true;
        e = (e as { cause?: unknown }).cause;
    }
    return false;
}

/** Rows written by a statement, from either driver's result shape (D1: `meta.changes`; the test driver: `changes`). */
function changesOf(result: unknown): number {
    const r = result as { changes?: number; meta?: { changes?: number } } | undefined;
    return r?.meta?.changes ?? r?.changes ?? 0;
}

/**
 * Spec 5H — Hash-chained, Ed25519-signed audit log.
 *
 * Each event row's hash = SHA-256(canonical_payload_json + (prev_hash ?? '')).
 * The hash is signed with the tenant's Ed25519 private key. Tampering with
 * any row breaks the chain at that row AND invalidates the signature.
 *
 * Canonical JSON: keys sorted alphabetically, no whitespace. Critical for
 * verify() to recompute the same hash bytes.
 */
export class AuditLogService {
    constructor(private db: D1Database, private signingKeys: SigningKeyService) {}

    private getDrizzle() {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return drizzle(this.db as any);
    }

    /**
     * True for the row of this signer and event that is the NEWEST, when it has the wanted values (see AppendOptions). Written as a
     * condition on the table's own columns so it serves both the lookup and the "not exists" guard of the insert.
     */
    private duplicateCondition(tenantId: string, requestId: string, event: AuditEvent, dedupe: NonNullable<AppendOptions['dedupe']>, now: number): SQL {
        const newest = sql`(select "id" from "esign_audit_logs" where "tenant_id" = ${tenantId} and "request_id" = ${requestId} and "event" = ${event} and json_extract("payload_json", '$.signerId') = ${dedupe.signerId} order by "created_at" desc, rowid desc limit 1)`;
        const parts: SQL[] = [sql`"id" = ${newest}`];
        for (const [key, value] of Object.entries(dedupe.match ?? {})) {
            parts.push(sql`json_extract("payload_json", ${`$.${key}`}) is ${value}`);
        }
        if (dedupe.windowMs !== undefined) parts.push(sql`"created_at" > ${now - dedupe.windowMs}`);
        return sql.join(parts, sql` and `);
    }

    private async findDuplicate(tenantId: string, requestId: string, event: AuditEvent, dedupe: NonNullable<AppendOptions['dedupe']>): Promise<{ id: string; hash: string } | null> {
        const row = await this.getDrizzle().select({ id: esignAuditLogs.id, hash: esignAuditLogs.hash }).from(esignAuditLogs)
            .where(this.duplicateCondition(tenantId, requestId, event, dedupe, Date.now())).limit(1).get();
        return row ?? null;
    }

    /**
     * Append a new event to the chain, taking the next position exactly once.
     *
     * The row is written by ONE statement that also checks the position: it inserts only while the newest row of the chain is still the
     * one this event was hashed onto (`prev_hash`). A read followed by a plain insert would let two requests that read the same newest
     * row both write, and the chain would fork (two rows with one predecessor). When the position was taken meanwhile, nothing is
     * written and the append starts again from the new end of the chain, re-hashing and re-signing, after a short random pause.
     *
     * "Newest" is by `created_at`, then insertion order (`rowid`). A new row's `created_at` is never earlier than the newest row's, even
     * when this isolate's clock is behind the one that wrote it: the chain is read in that order, and a row dated before its predecessor
     * would read as a break.
     *
     * The PARTIAL unique index `idx_esign_audit_logs_event_dedup` (on tenant_id, request_id, event, WHERE event NOT LIKE 'signer.%')
     * makes envelope-level events ('agreement.signed', 'workflow.complete', …) idempotent: a duplicate hits the constraint and the
     * existing row is returned. ONLY that case is treated as "already recorded". Any other failure is thrown, so a caller never
     * mistakes a write that did not happen for one that did (and never receives another signer's row). Per-signer events are not
     * covered by the index, so they never reach that branch; `options.dedupe` is their idempotency, checked in the same statement.
     *
     * After the last lost position it throws `ServiceUnavailable`; callers decide whether that refuses their action (signing) or is
     * logged and tolerated (see the callers in server/api).
     */
    async append(
        tenantId: string,
        requestId: string,
        event: AuditEvent,
        payload: Record<string, unknown>,
        options: AppendOptions = {},
    ): Promise<{ id: string; hash: string }> {
        const { privateKey, fingerprint } = await this.signingKeys.ensureKeypair(tenantId);
        const db = this.getDrizzle();
        const canonicalPayload = canonicalJson(payload);
        const { dedupe } = options;

        for (let attempt = 0; attempt < MAX_APPEND_ATTEMPTS; attempt += 1) {
            if (attempt > 0) await new Promise<void>((resolve) => { setTimeout(resolve, Math.random() * RETRY_JITTER_MS * attempt); });
            if (dedupe) {
                const duplicate = await this.findDuplicate(tenantId, requestId, event, dedupe);
                if (duplicate) return duplicate;
            }
            const prev = await db.select({ hash: esignAuditLogs.hash, createdAt: esignAuditLogs.createdAt }).from(esignAuditLogs)
                .where(and(eq(esignAuditLogs.tenantId, tenantId), eq(esignAuditLogs.requestId, requestId)))
                .orderBy(desc(esignAuditLogs.createdAt), desc(sql`rowid`)).limit(1).get();

            const prevHash = prev?.hash ?? null;
            const hash = await sha256Hex(canonicalPayload + (prevHash ?? ''));
            const sig = await crypto.subtle.sign('Ed25519', privateKey, hexDecode(hash) as unknown as ArrayBuffer);
            const signature = base64UrlEncode(new Uint8Array(sig));
            const id = crypto.randomUUID();
            const now = Date.now();
            const createdAt = prev ? Math.max(now, prev.createdAt.getTime()) : now;

            const notDuplicate = dedupe ? sql` and not exists (select 1 from "esign_audit_logs" where ${this.duplicateCondition(tenantId, requestId, event, dedupe, now)})` : sql``;
            let result: unknown;
            try {
                result = await db.run(sql`insert into "esign_audit_logs" ("id", "tenant_id", "request_id", "event", "payload_json", "prev_hash", "hash", "signature", "key_fingerprint", "created_at")
                    select ${id}, ${tenantId}, ${requestId}, ${event}, ${canonicalPayload}, ${prevHash}, ${hash}, ${signature}, ${fingerprint}, ${createdAt}
                    where (select "hash" from "esign_audit_logs" where "tenant_id" = ${tenantId} and "request_id" = ${requestId} order by "created_at" desc, rowid desc limit 1) is ${prevHash}${notDuplicate}`);
            } catch (e) {
                // Envelope-level events are one per envelope: a unique-constraint failure on one means it is already recorded.
                if (isUniqueViolation(e) && !event.startsWith('signer.')) {
                    const existing = await db.select().from(esignAuditLogs)
                        .where(and(eq(esignAuditLogs.tenantId, tenantId), eq(esignAuditLogs.requestId, requestId), eq(esignAuditLogs.event, event))).get();
                    if (existing) {
                        logger.info('audit.append.idempotent', { tenantId, requestId, event });
                        return { id: existing.id, hash: existing.hash };
                    }
                }
                throw e;
            }
            if (changesOf(result) > 0) return { id, hash };
            // Nothing was written: another writer took this position (retry from the new end), or the once-only guard fired (found next round).
            logger.info('audit.append.position_taken', { tenantId, requestId, event, attempt: attempt + 1 });
        }
        // The last round may have lost to the guard rather than to a writer: look once more before giving up.
        if (dedupe) {
            const duplicate = await this.findDuplicate(tenantId, requestId, event, dedupe);
            if (duplicate) return duplicate;
        }
        logger.error('audit.append.contended', { tenantId, requestId, event });
        throw Errors.ServiceUnavailable('The signing record is busy. Try again in a moment.');
    }

    /**
     * Verify the entire chain for a request. Returns {valid, brokenAt?, reason?}.
     * Checks: prev_hash linkage, hash recomputation, key identity, Ed25519 signature.
     *
     * **Each row is checked against the key that sealed IT**, resolved from the
     * `key_fingerprint` the row recorded — never against whatever key the tenant
     * happens to hold today. That is what makes rotation survivable: retiring a
     * key leaves its public half on file, so chains signed under it keep
     * verifying, including a chain that spans a rotation mid-envelope.
     *
     * `key_mismatch` means the row names a key this tenant does not hold at all.
     * It is separate from `signature` on purpose, and the distinction is not
     * academic: this result reaches the public verifier page. Reporting
     * `signature` would tell a reader that a real signer's real signature failed
     * to check out, when what actually happened is that we cannot produce the
     * key — a statement against the signer's interest, which this API must
     * never make.
     */
    async verifyChain(tenantId: string, requestId: string): Promise<
        | { valid: true; events: number }
        | { valid: false; reason: 'not_found' | 'chain' | 'hash' | 'key_mismatch' | 'signature' | 'no_key'; brokenAt?: string }
    > {
        const events = await this.getDrizzle().select().from(esignAuditLogs)
            .where(and(eq(esignAuditLogs.tenantId, tenantId), eq(esignAuditLogs.requestId, requestId)))
            .orderBy(asc(esignAuditLogs.createdAt), asc(sql`rowid`)).all();
        if (events.length === 0) return { valid: false, reason: 'not_found' };

        // Distinguishes "this tenant has never had a key" from "this row names a
        // key we do not hold" — the second is a per-row answer, resolved below.
        if (!await this.signingKeys.getPublicKey(tenantId)) return { valid: false, reason: 'no_key' };

        // One lookup per distinct key, not per row: a chain that spans a
        // rotation uses two, and every other chain uses one.
        const keys = new Map<string, CryptoKey | null>();
        let prevHash: string | null = null;
        for (const ev of events) {
            if ((ev.prevHash ?? null) !== prevHash) {
                return { valid: false, reason: 'chain', brokenAt: ev.id };
            }
            const expected = await sha256Hex(ev.payloadJson + (ev.prevHash ?? ''));
            if (expected !== ev.hash) {
                return { valid: false, reason: 'hash', brokenAt: ev.id };
            }
            // Resolve THIS row's key before testing its signature. A row we have
            // no key for is unverifiable, which is not the same finding as a
            // signature that failed to verify.
            if (!keys.has(ev.keyFingerprint)) {
                const info = await this.signingKeys.getPublicKeyByFingerprint(tenantId, ev.keyFingerprint);
                keys.set(ev.keyFingerprint, info?.publicKey ?? null);
            }
            const rowKey = keys.get(ev.keyFingerprint) ?? null;
            if (!rowKey) {
                return { valid: false, reason: 'key_mismatch', brokenAt: ev.id };
            }
            const ok = await crypto.subtle.verify(
                'Ed25519', rowKey,
                base64UrlDecode(ev.signature) as unknown as ArrayBuffer,
                hexDecode(ev.hash) as unknown as ArrayBuffer,
            );
            if (!ok) {
                return { valid: false, reason: 'signature', brokenAt: ev.id };
            }
            prevHash = ev.hash;
        }
        return { valid: true, events: events.length };
    }
}

/**
 * Canonical JSON: keys sorted alphabetically (recursive), no whitespace.
 * This is the single source of truth for what gets hashed — both append()
 * and verifyChain() use this so re-hashing always matches.
 */
function canonicalJson(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson((value as Record<string, unknown>)[k])).join(',') + '}';
}

function base64UrlEncode(bytes: Uint8Array): string {
    let s = '';
    for (let i = 0; i < bytes.byteLength; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
