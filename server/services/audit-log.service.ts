import { drizzle } from 'drizzle-orm/d1';
import { eq, and, desc, asc } from 'drizzle-orm';
import { esignAuditLogs } from '../lib/db/schema';
import { logger } from '../lib/logger';
import type { SigningKeyService} from './signing-key.service';
import { sha256Hex, hexDecode, base64UrlDecode } from './signing-key.service';

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
     * Append a new event to the chain. The PARTIAL unique index
     * `idx_esign_audit_logs_event_dedup` (on tenant_id, request_id, event,
     * WHERE event NOT LIKE 'signer.%') makes envelope-level events
     * ('agreement.signed', 'workflow.complete', …) idempotent — a duplicate
     * append hits the constraint and returns the existing row instead of
     * forking the chain. Per-signer events ('signer.signed', 'signer.declined')
     * are EXCLUDED from the index so a multi-signer envelope can legitimately
     * append the same event type once per signer.
     */
    async append(
        tenantId: string,
        requestId: string,
        event: AuditEvent,
        payload: Record<string, unknown>
    ): Promise<{ id: string; hash: string }> {
        const { privateKey, fingerprint } = await this.signingKeys.ensureKeypair(tenantId);

        const prev = await this.getDrizzle().select().from(esignAuditLogs)
            .where(and(eq(esignAuditLogs.tenantId, tenantId), eq(esignAuditLogs.requestId, requestId)))
            .orderBy(desc(esignAuditLogs.createdAt)).limit(1).get();

        const prevHash = prev?.hash ?? null;
        const canonicalPayload = canonicalJson(payload);
        const hash = await sha256Hex(canonicalPayload + (prevHash ?? ''));
        const sig = await crypto.subtle.sign('Ed25519', privateKey, hexDecode(hash) as unknown as ArrayBuffer);
        const signature = base64UrlEncode(new Uint8Array(sig));

        const id = crypto.randomUUID();
        try {
            await this.getDrizzle().insert(esignAuditLogs).values({
                id,
                tenantId,
                requestId,
                event,
                payloadJson: canonicalPayload,
                prevHash,
                hash,
                signature,
                keyFingerprint: fingerprint,
                createdAt: new Date(),
            });
        } catch (e) {
            // Partial UNIQUE INDEX on (tenant_id, request_id, event) for
            // envelope-level (non-signer) events means double-appends are
            // idempotent — return the existing row. Per-signer events are not
            // covered by the index, so they never reach this branch.
            const existing = await this.getDrizzle().select().from(esignAuditLogs)
                .where(and(
                    eq(esignAuditLogs.tenantId, tenantId),
                    eq(esignAuditLogs.requestId, requestId),
                    eq(esignAuditLogs.event, event),
                )).get();
            if (existing) {
                logger.info('audit.append.idempotent', { tenantId, requestId, event });
                return { id: existing.id, hash: existing.hash };
            }
            throw e;
        }

        return { id, hash };
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
            .orderBy(asc(esignAuditLogs.createdAt)).all();
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
