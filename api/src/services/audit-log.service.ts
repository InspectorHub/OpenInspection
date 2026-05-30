import { drizzle } from 'drizzle-orm/d1';
import { eq, and, desc, asc } from 'drizzle-orm';
import { esignAuditLogs } from '../lib/db/schema';
import { logger } from '../lib/logger';
import { SigningKeyService, sha256Hex, hexDecode, base64UrlDecode } from './signing-key.service';

export type AuditEvent =
    | 'request.created'
    | 'request.sent'
    | 'request.viewed'
    | 'agreement.signed'
    | 'agreement.inspector_signed'
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
     * Append a new event to the chain. Idempotent for terminal events
     * ('agreement.signed', 'workflow.complete') via UNIQUE INDEX —
     * concurrent appends will fail with constraint error rather than
     * fork the chain.
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
                createdAt: Date.now(),
            });
        } catch (e) {
            // UNIQUE INDEX on (tenant_id, request_id, event) for terminal events
            // means double-appends are silently OK — return the existing row.
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
     * Checks: prev_hash linkage, hash recomputation, Ed25519 signature.
     */
    async verifyChain(tenantId: string, requestId: string): Promise<
        | { valid: true; events: number }
        | { valid: false; reason: 'not_found' | 'chain' | 'hash' | 'signature' | 'no_key'; brokenAt?: string }
    > {
        const events = await this.getDrizzle().select().from(esignAuditLogs)
            .where(and(eq(esignAuditLogs.tenantId, tenantId), eq(esignAuditLogs.requestId, requestId)))
            .orderBy(asc(esignAuditLogs.createdAt)).all();
        if (events.length === 0) return { valid: false, reason: 'not_found' };

        const keyInfo = await this.signingKeys.getPublicKey(tenantId);
        if (!keyInfo) return { valid: false, reason: 'no_key' };

        let prevHash: string | null = null;
        for (const ev of events) {
            if ((ev.prevHash ?? null) !== prevHash) {
                return { valid: false, reason: 'chain', brokenAt: ev.id };
            }
            const expected = await sha256Hex(ev.payloadJson + (ev.prevHash ?? ''));
            if (expected !== ev.hash) {
                return { valid: false, reason: 'hash', brokenAt: ev.id };
            }
            const ok = await crypto.subtle.verify(
                'Ed25519', keyInfo.publicKey,
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
