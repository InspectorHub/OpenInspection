import { drizzle } from 'drizzle-orm/d1';
import { eq, and, inArray, lt, sql, desc, asc } from 'drizzle-orm';
import { agreements, agreementRequests, agreementSigners, inspections } from '../lib/db/schema';
import * as schema from '../lib/db/schema';
import { Errors } from '../lib/errors';
import { logger } from '../lib/logger';
import { mintToken, hashToken, deadTokenSentinel, resolveTokenRow } from '../lib/token-hash';
import { sealToken, openToken } from '../lib/config-crypto';

/** SHA-256 hex — reused for both token hashing and content-snapshot hashing. */
const sha256Hex = hashToken;

export interface SignerInput {
    name: string;
    email: string;
    role?: 'client' | 'co_client' | 'agent' | 'other';
    contactId?: string | null;
}

export interface ResolvedSigner {
    signer: typeof agreementSigners.$inferSelect;
    envelope: typeof agreementRequests.$inferSelect;
}

/**
 * Track I-a — derive the envelope (agreement_requests.status) as a STORED
 * aggregate of its signer statuses under the completion policy.
 *   - 'all' : every signer must sign for the envelope to be 'signed'; any
 *             decline drags the whole envelope to 'declined'.
 *   - 'one' : a single signature completes the envelope; the envelope only
 *             declines when EVERY signer has declined.
 */
export function computeEnvelopeStatus(
    policy: 'all' | 'one',
    signers: Array<{ status: string }>,
): 'pending' | 'sent' | 'viewed' | 'signed' | 'declined' {
    if (signers.length === 0) return 'pending';
    const all = (s: string) => signers.every((x) => x.status === s);
    const any = (s: string) => signers.some((x) => x.status === s);
    if (all('declined')) return 'declined';
    if (policy === 'one' && any('signed')) return 'signed';
    if (policy === 'all') {
        if (any('declined')) return 'declined';
        if (all('signed')) return 'signed';
    }
    if (any('viewed') || any('signed')) return 'viewed';
    if (any('sent')) return 'sent';
    return 'pending';
}

/**
 * Sanitize HTML output from Quill editor.
 * Allow-list matches the editor's toolbar: bold/italic/underline, h2/h3, lists, indent classes.
 * Strips all other tags, all attributes except `class` (for ql-indent-N), and any script/style/iframe content entirely.
 */
function sanitizeAgreementHtml(html: string): string {
    if (!html) return '';
    // Plain text? No HTML detected — return as-is, render-time wraps it
    if (!html.includes('<')) return html;

    let out = html;

    // Remove dangerous element pairs and their content (script, style, iframe, object, embed, form, etc.)
    const dangerousElements = ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'svg', 'math', 'link', 'meta'];
    for (const tag of dangerousElements) {
        const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>|<${tag}\\b[^>]*\\/?>`, 'gi');
        out = out.replace(re, '');
    }

    // Remove HTML comments (could hide payload like <!--><script>...)
    // CodeQL js/incomplete-multi-character-sanitization — single pass can leave reconstructed
    // <!-- after a partial removal. Loop until stable.
    {
        let prev;
        do { prev = out; out = out.replace(/<!--[\s\S]*?-->/g, ''); } while (out !== prev);
    }

    // Allow-listed tags. Anything else gets stripped (tags only, content preserved).
    const allowed = new Set(['p', 'strong', 'em', 'u', 'b', 'i', 'h2', 'h3', 'ol', 'ul', 'li', 'br', 'span']);

    // Match any tag (opening, closing, self-closing). For each match, decide: keep, strip-tag, or transform.
    out = out.replace(/<\/?([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g, (_match, tag: string, attrs: string) => {
        const tagLower = tag.toLowerCase();
        if (!allowed.has(tagLower)) return '';
        // Determine if it's a closing tag
        const isClosing = _match.startsWith('</');
        if (isClosing) return `</${tagLower}>`;

        // Allow `class` attribute only for ol/ul (Quill uses ql-indent-N for indent)
        if ((tagLower === 'ol' || tagLower === 'ul' || tagLower === 'li' || tagLower === 'p') && attrs) {
            const classMatch = attrs.match(/\bclass="(ql-[a-z0-9-]+(?:\s+ql-[a-z0-9-]+)*)"/i);
            if (classMatch) return `<${tagLower} class="${classMatch[1]}">`;
        }
        // Self-closing for br
        if (tagLower === 'br') return '<br>';
        return `<${tagLower}>`;
    });

    // Strip any remaining `javascript:`, `data:`, or event-handler attribute leftovers (defense in depth)
    // CodeQL js/incomplete-multi-character-sanitization — broaden boundary from \s+ to
    // (?:\s|^|>) so on* attributes flush against tag opening (e.g., `<a"on click=x>`)
    // are also caught. Then loop until stable for chained removals.
    {
        let prev;
        do {
            prev = out;
            out = out
                .replace(/(?:\s|^|>)on\w+\s*=\s*"[^"]*"/gi, m => m.startsWith('>') ? '>' : '')
                .replace(/(?:\s|^|>)on\w+\s*=\s*'[^']*'/gi, m => m.startsWith('>') ? '>' : '');
        } while (out !== prev);
    }

    return out;
}

/**
 * Service to manage tenant-specific agreement templates (signatures, terms).
 */
export class AgreementService {
    constructor(
        private db: D1Database,
        private secrets?: { jwtSecret: string; jwtSecretPrevious?: string },
    ) {}

    private getDrizzle() {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return drizzle(this.db as any);
    }

    /**
     * Lists all agreement templates for a tenant.
     */
    async listAgreements(tenantId: string) {
        const db = this.getDrizzle();
        return db.select().from(agreements).where(eq(agreements.tenantId, tenantId)).all();
    }

    /**
     * Creates a new agreement template.
     */
    async createAgreement(tenantId: string, name: string, content: string) {
        const db = this.getDrizzle();
        const sanitizedContent = sanitizeAgreementHtml(content);
        const newAgreement = {
            id: crypto.randomUUID(),
            tenantId,
            name,
            content: sanitizedContent,
            version: 1,
            createdAt: new Date(),
        };
        await db.insert(agreements).values(newAgreement);
        return newAgreement;
    }

    /**
     * Updates an existing agreement template, incrementing the version.
     */
    async updateAgreement(id: string, tenantId: string, name?: string, content?: string) {
        const db = this.getDrizzle();
        const existing = await db.select().from(agreements).where(and(eq(agreements.id, id), eq(agreements.tenantId, tenantId))).get();

        if (!existing) {
            throw Errors.NotFound('Agreement template not found');
        }

        const sanitizedContent = content !== undefined ? sanitizeAgreementHtml(content) : existing.content;
        const updateData = {
            name: name ??  existing.name,
            content: sanitizedContent,
            version: (existing.version as number) + 1,
        };

        await db.update(agreements).set(updateData).where(and(eq(agreements.id, id), eq(agreements.tenantId, tenantId)));
        return { ...existing, ...updateData };
    }

    /**
     * Deletes an agreement template.
     */
    async deleteAgreement(id: string, tenantId: string) {
        const db = this.getDrizzle();
        const existing = await db.select().from(agreements).where(and(eq(agreements.id, id), eq(agreements.tenantId, tenantId))).get();

        if (!existing) {
            throw Errors.NotFound('Agreement template not found');
        }

        await db.delete(agreements).where(and(eq(agreements.id, id), eq(agreements.tenantId, tenantId)));
    }

    /**
     * Creates a signing request and returns the token.
     */
    async createSigningRequest(tenantId: string, data: {
        agreementId: string;
        clientEmail: string;
        clientName?: string | null;
        inspectionId?: string | null;
    }) {
        const db = this.getDrizzle();
        const agreement = await db.select().from(agreements)
            .where(and(eq(agreements.id, data.agreementId), eq(agreements.tenantId, tenantId))).get();
        if (!agreement) throw Errors.NotFound('Agreement template not found');

        const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
        const request = {
            id: crypto.randomUUID(),
            tenantId,
            agreementId: data.agreementId,
            clientEmail: data.clientEmail,
            clientName: data.clientName ?? null,
            inspectionId: data.inspectionId ?? null,
            token,
            status: 'pending' as const,
            signatureBase64: null,
            signedAt: null,
            viewedAt: null,
            createdAt: new Date(),
        };
        await db.insert(agreementRequests).values(request);
        return { ...request, agreementName: agreement.name };
    }

    /**
     * Looks up a signing request by its public token (no tenant scope — token is the secret).
     */
    async getRequestByToken(token: string) {
        return this.getDrizzle().select().from(agreementRequests).where(eq(agreementRequests.token, token)).get();
    }

    /**
     * iter-2 production bug #9 — given an inspection id, return the most recent
     * non-terminal (pending/sent/viewed) signing request for that inspection
     * within the given tenant. Used by the public `/sign/:id` redirect route
     * so a customer who hits the report-gate "Sign agreement" CTA lands on
     * the live agreement page instead of a 404.
     *
     * Returns `null` when the inspection has no agreement request at all,
     * or when all existing requests are in a terminal state (signed /
     * declined / expired). Tenant-scoped — never crosses workspaces.
     *
     * NOTE: this is a read-only counterpart to `findOrCreate()`. Callers
     * that want to mint a token when none exists should use the latter;
     * the public `/sign/:id` redirect deliberately stays read-only so an
     * unauthenticated customer cannot trigger row inserts.
     */
    async findPendingByInspectionId(tenantId: string, inspectionId: string): Promise<{ token: string; status: string; requestId: string } | null> {
        const row = await this.getDrizzle().select({
            token:  agreementRequests.token,
            status: agreementRequests.status,
            requestId: agreementRequests.id,
        })
            .from(agreementRequests)
            .where(and(
                eq(agreementRequests.tenantId, tenantId),
                eq(agreementRequests.inspectionId, inspectionId),
                inArray(agreementRequests.status, ['pending', 'sent', 'viewed']),
            ))
            .orderBy(desc(agreementRequests.createdAt))
            .limit(1)
            .get();
        return row ?? null;
    }

    /**
     * Returns the agreement content for a given public token.
     */
    async getAgreementByToken(token: string) {
        const request = await this.getRequestByToken(token);
        if (!request) throw Errors.NotFound('Signing request not found');
        const agreement = await this.getDrizzle().select().from(agreements).where(eq(agreements.id, request.agreementId)).get();
        if (!agreement) throw Errors.NotFound('Agreement not found');
        return { request, agreement };
    }

    /**
     * Records a client signature on a signing request (legacy route handler API).
     * Use markSigned() for state-machine flows with explicit signedAtMs.
     */
    async signRequest(token: string, signatureBase64: string, verificationToken?: string) {
        const request = await this.getRequestByToken(token);
        if (!request) throw Errors.NotFound('Signing request not found');
        if (request.status === 'signed') throw Errors.Conflict('Agreement already signed');

        await this.getDrizzle()
            .update(agreementRequests)
            .set({ status: 'signed', signatureBase64, signedAt: new Date(), verificationToken: verificationToken ?? null })
            .where(eq(agreementRequests.token, token));
        return { ...request, status: 'signed' as const, signatureBase64, signedAt: new Date() };
    }

    /**
     * Lists all signing requests for a tenant (most recent first).
     */
    async listRequests(tenantId: string) {
        return this.getDrizzle().select().from(agreementRequests)
            .where(eq(agreementRequests.tenantId, tenantId))
            .all();
    }

    // -------------------------------------------------------------------------
    // State machine — Spec 2A
    // -------------------------------------------------------------------------

    /**
     * Idempotent — returns existing non-terminal request for the inspection,
     * or creates a new row with status='sent'. Throws if the tenant has no
     * agreement template at all (admin must create one in /agreements first).
     */
    async findOrCreate(
        tenantId: string,
        inspectionId: string,
        opts?: { signers?: SignerInput[]; completionPolicy?: 'all' | 'one' },
    ): Promise<{ token: string; status: string; alreadyExists: boolean; requestId: string }> {
        const db = this.getDrizzle();
        // Look for an existing non-terminal request
        const existing = await db.select().from(agreementRequests)
            .where(and(
                eq(agreementRequests.tenantId, tenantId),
                eq(agreementRequests.inspectionId, inspectionId),
                inArray(agreementRequests.status, ['pending', 'sent', 'viewed']),
            )).limit(1);
        if (existing.length > 0) {
            // Reuse: hand back the FIRST signer's plaintext link when we can
            // reconstruct it (tier-2 token_enc); otherwise fall back to the
            // legacy envelope token (still satisfies the public lookup path).
            const env = existing[0];
            let token = env.token;
            let firstSigner = (await db.select().from(agreementSigners)
                .where(eq(agreementSigners.requestId, env.id))
                .orderBy(asc(agreementSigners.createdAt)).limit(1))[0];
            // Legacy reuse path: an envelope created via `createSigningRequest`
            // has NO signer rows. Synthesize a default client signer (identical
            // shape to the public resolution path) so the on-site sign flow,
            // which enumerates signers, finds one to target instead of 409ing
            // on an empty signer set.
            if (!firstSigner) {
                firstSigner = await this.synthesizeDefaultSigner(env);
            }
            try {
                token = await this.getSignerLink(env.id, firstSigner.id);
            } catch (e) {
                logger.warn('AgreementService.findOrCreate reuse-link failed', { requestId: env.id, error: e instanceof Error ? e.message : String(e) });
            }
            return { token, status: env.status, alreadyExists: true, requestId: env.id };
        }
        // Find inspection + a usable agreement template
        const inspRows = await db.select().from(inspections)
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId))).limit(1);
        if (inspRows.length === 0) throw Errors.NotFound('Inspection not found');
        const insp = inspRows[0];
        // Pick the tenant's first agreement template (simplest MVP)
        const agrRows = await db.select().from(agreements)
            .where(eq(agreements.tenantId, tenantId)).limit(1);
        if (agrRows.length === 0) throw Errors.NotFound('No agreement template configured');
        const agreement = agrRows[0];

        // Resolve the signer set (default = single client signer from the inspection)
        const signerInputs: SignerInput[] = opts?.signers && opts.signers.length > 0
            ? opts.signers
            : [{ name: insp.clientName || insp.clientEmail || 'Client', email: insp.clientEmail || '', role: 'client' }];
        // Validate duplicate emails BEFORE any insert (the UNIQUE index is the backstop)
        const seen = new Set<string>();
        for (const s of signerInputs) {
            const key = s.email.trim().toLowerCase();
            if (seen.has(key)) throw Errors.Conflict('Duplicate signer email');
            seen.add(key);
        }

        const completionPolicy = opts?.completionPolicy ?? 'all';
        const now = new Date();
        const requestId = crypto.randomUUID();
        const contentSnapshot = agreement.content;
        const contentHash = await sha256Hex(contentSnapshot);

        const newRow = {
            id: requestId,
            tenantId,
            inspectionId,
            agreementId: agreement.id,
            clientEmail: insp.clientEmail || '',
            clientName: insp.clientName,
            // Never distributed — satisfies NOT NULL + UNIQUE on the legacy column.
            token: crypto.randomUUID(),
            status: 'sent' as const,
            signatureBase64: null,
            signedAt: null,
            viewedAt: null,
            sentAt: now,
            lastError: null,
            contentSnapshot,
            contentHash,
            completionPolicy,
            createdAt: now,
        };
        await db.insert(agreementRequests).values(newRow);

        // Insert signer rows, minting one tier-2 token per signer.
        let firstPlaintext = '';
        for (let i = 0; i < signerInputs.length; i++) {
            const s = signerInputs[i];
            const plaintext = mintToken();
            if (i === 0) firstPlaintext = plaintext;
            await db.insert(agreementSigners).values({
                id: crypto.randomUUID(),
                tenantId,
                requestId,
                name: s.name,
                email: s.email,
                role: s.role ?? 'client',
                contactId: s.contactId ?? null,
                tokenHash: await hashToken(plaintext),
                tokenEnc: this.secrets ? await sealToken(plaintext, tenantId, this.secrets.jwtSecret) : null,
                status: 'sent',
                createdAt: now,
            });
        }

        logger.info('AgreementService.findOrCreate created', { tenantId, inspectionId, requestId, signers: signerInputs.length, completionPolicy });
        return { token: firstPlaintext, status: 'sent', alreadyExists: false, requestId };
    }

    /**
     * Marks a request as viewed. Returns tenantId + inspectionId + agreementId,
     * or null if the token is not found or is expired.
     * Idempotent — calling on an already-viewed/signed/declined row is a no-op.
     *
     * NOTE: Route handler fires 'agreement.viewed' automation event after this
     * returns, avoiding AgreementService <-> AutomationService circular DI.
     */
    async markViewed(token: string): Promise<{ tenantId: string; inspectionId: string | null; agreementId: string } | null> {
        const db = this.getDrizzle();
        const rows = await db.select().from(agreementRequests).where(eq(agreementRequests.token, token)).limit(1);
        if (rows.length === 0) return null;
        const row = rows[0];
        if (row.status === 'expired') return null;
        if (row.status === 'pending' || row.status === 'sent') {
            await db.update(agreementRequests)
                .set({ status: 'viewed', viewedAt: new Date() })
                .where(eq(agreementRequests.token, token));
        }
        return { tenantId: row.tenantId, inspectionId: row.inspectionId, agreementId: row.agreementId };
    }

    /**
     * Records a client signature on a signing request.
     * Throws Conflict if the request is declined or expired.
     * Idempotent if already signed.
     *
     * NOTE: Route handler fires 'agreement.signed' automation event after this returns.
     */
    async markSigned(token: string, signatureBase64: string, signedAtMs: number): Promise<{ tenantId: string; inspectionId: string | null }> {
        const db = this.getDrizzle();
        const rows = await db.select().from(agreementRequests).where(eq(agreementRequests.token, token)).limit(1);
        if (rows.length === 0) throw Errors.NotFound('Agreement request not found');
        const row = rows[0];
        if (row.status === 'declined' || row.status === 'expired') {
            throw Errors.Conflict('Agreement is no longer signable');
        }
        if (row.status === 'signed') {
            // Idempotent — already signed
            return { tenantId: row.tenantId, inspectionId: row.inspectionId };
        }
        await db.update(agreementRequests)
            .set({ status: 'signed', signatureBase64, signedAt: new Date(signedAtMs) })
            .where(eq(agreementRequests.token, token));
        return { tenantId: row.tenantId, inspectionId: row.inspectionId };
    }

    /**
     * Marks a signing request as declined with an optional reason stored in lastError.
     * Throws Conflict if the request is already signed or expired.
     * Idempotent if already declined.
     *
     * NOTE: Route handler fires 'agreement.declined' automation event after this returns.
     */
    async markDeclined(token: string, reason?: string): Promise<{ tenantId: string; inspectionId: string | null }> {
        const db = this.getDrizzle();
        const rows = await db.select().from(agreementRequests).where(eq(agreementRequests.token, token)).limit(1);
        if (rows.length === 0) throw Errors.NotFound('Agreement request not found');
        const row = rows[0];
        if (row.status === 'signed' || row.status === 'expired') {
            throw Errors.Conflict('Agreement cannot be declined');
        }
        if (row.status === 'declined') return { tenantId: row.tenantId, inspectionId: row.inspectionId };
        await db.update(agreementRequests)
            .set({ status: 'declined', lastError: reason ? reason.slice(0, 500) : null })
            .where(eq(agreementRequests.token, token));
        return { tenantId: row.tenantId, inspectionId: row.inspectionId };
    }

    /**
     * Cron handler — marks all non-terminal rows with sentAt older than N days
     * as expired. Returns the count of newly-expired rows.
     * Idempotent — re-running picks up nothing once all old rows are expired.
     */
    async expireOlderThan(days: number): Promise<number> {
        const db = this.getDrizzle();
        // Compare via lt() with a Date so Drizzle encodes the cutoff through the
        // sent_at column's mode mapper. (The previous raw-sql comparison bound a
        // MILLISECOND cutoff against a SECONDS-stored column — always true — so the
        // sweep expired every pending/sent/viewed envelope regardless of age.)
        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        await db.update(agreementRequests)
            .set({ status: 'expired' })
            .where(and(
                inArray(agreementRequests.status, ['pending', 'sent', 'viewed']),
                lt(agreementRequests.sentAt, cutoff),
            ));
        // Track I-a — cascade expiry to signer rows under any expired envelope.
        // Idempotent: only non-terminal signers under an 'expired' envelope are
        // touched, so reruns and already-signed/declined signers are untouched.
        await db.update(agreementSigners)
            .set({ status: 'expired' })
            .where(and(
                inArray(agreementSigners.status, ['pending', 'sent', 'viewed']),
                sql`${agreementSigners.requestId} IN (SELECT id FROM ${agreementRequests} WHERE ${agreementRequests.status} = 'expired')`,
            ));
        // D1/Drizzle does not expose rowsAffected; count expired rows within the cutoff window
        const expiredRows = await db.select().from(agreementRequests)
            .where(and(
                eq(agreementRequests.status, 'expired'),
                lt(agreementRequests.sentAt, cutoff),
            ));
        const count = expiredRows.length;
        logger.info('AgreementService.expireOlderThan', { days, count });
        return count;
    }

    // -------------------------------------------------------------------------
    // Track I-a — signer-level state machine (envelope v2)
    // -------------------------------------------------------------------------

    /** Reload all signers of an envelope ordered by creation. */
    private async loadSigners(requestId: string) {
        return this.getDrizzle().select().from(agreementSigners)
            .where(eq(agreementSigners.requestId, requestId))
            .orderBy(asc(agreementSigners.createdAt))
            .all();
    }

    /**
     * Resolve a presented public token to a signer + its envelope. Signer
     * tokens resolve first (tier-2 hash-at-rest; plaintext is NEVER stored, so
     * the byPlaintext branch is always null). On a miss we fall back to legacy
     * envelope tokens (tokenHash, then permanent plaintext fallback with a lazy
     * hash-upgrade) and load that envelope's first signer.
     */
    async getSignerByPresentedToken(presented: string): Promise<ResolvedSigner | null> {
        const db = this.getDrizzle();
        // 1) Signer-token path
        const signer = await resolveTokenRow<typeof agreementSigners.$inferSelect>({
            presented,
            byHash: async (hash) =>
                (await db.select().from(agreementSigners).where(eq(agreementSigners.tokenHash, hash)).limit(1))[0] ?? null,
            byPlaintext: async () => null, // signer plaintext is never persisted
            upgrade: async () => { /* nothing to upgrade — hash is the only key */ },
        });
        if (signer) {
            const envRows = await db.select().from(agreementRequests).where(eq(agreementRequests.id, signer.requestId)).limit(1);
            if (envRows.length === 0) return null;
            return { signer, envelope: envRows[0] };
        }

        // 2) Legacy envelope-token path
        const envelope = await resolveTokenRow<typeof agreementRequests.$inferSelect>({
            presented,
            byHash: async (hash) =>
                (await db.select().from(agreementRequests).where(eq(agreementRequests.tokenHash, hash)).limit(1))[0] ?? null,
            byPlaintext: async (token) =>
                (await db.select().from(agreementRequests).where(eq(agreementRequests.token, token)).limit(1))[0] ?? null,
            upgrade: async (row, hash) => {
                await db.update(agreementRequests)
                    .set({ tokenHash: hash, token: deadTokenSentinel(row.id) })
                    .where(eq(agreementRequests.id, row.id));
            },
        });
        if (!envelope) return null;

        // Load the envelope's first signer; synthesize one for weird legacy data.
        const signers = await this.loadSigners(envelope.id);
        if (signers.length > 0) {
            return { signer: signers[0], envelope };
        }
        const created = await this.synthesizeDefaultSigner(envelope);
        return { signer: created, envelope };
    }

    /**
     * Synthesize a single default client signer for a legacy envelope that has
     * none (created via the pre-envelope-v2 `createSigningRequest` path). The
     * signer mirrors the envelope's client + status and carries no link token
     * (tokenHash/tokenEnc NULL) — the legacy plaintext envelope token remains
     * the distributed link. Shared by `getSignerByPresentedToken` (public
     * resolution) and `findOrCreate` (in-app reuse) so the two stay identical.
     */
    private async synthesizeDefaultSigner(
        envelope: typeof agreementRequests.$inferSelect,
    ): Promise<typeof agreementSigners.$inferSelect> {
        const db = this.getDrizzle();
        const synthId = crypto.randomUUID();
        const now = new Date();
        await db.insert(agreementSigners).values({
            id: synthId,
            tenantId: envelope.tenantId,
            requestId: envelope.id,
            name: envelope.clientName || envelope.clientEmail || 'Client',
            email: envelope.clientEmail || '',
            role: 'client',
            tokenHash: null,
            tokenEnc: null,
            status: envelope.status,
            createdAt: now,
        });
        return (await db.select().from(agreementSigners).where(eq(agreementSigners.id, synthId)).limit(1))[0];
    }

    /** List all signers of an envelope (tenant-scoped), ordered by creation. */
    async listSigners(tenantId: string, requestId: string): Promise<Array<typeof agreementSigners.$inferSelect>> {
        return this.getDrizzle().select().from(agreementSigners)
            .where(and(eq(agreementSigners.tenantId, tenantId), eq(agreementSigners.requestId, requestId)))
            .orderBy(asc(agreementSigners.createdAt))
            .all();
    }

    /**
     * Returns the plaintext public link token for a signer. Decrypts the sealed
     * token_enc (current → previous secret); on a backfilled row (token_enc
     * NULL) mints a fresh token and persists tokenHash + token_enc.
     */
    async getSignerLink(requestId: string, signerId: string): Promise<string> {
        const db = this.getDrizzle();
        const rows = await db.select().from(agreementSigners)
            .where(and(eq(agreementSigners.id, signerId), eq(agreementSigners.requestId, requestId))).limit(1);
        if (rows.length === 0) throw Errors.NotFound('Signer not found');
        const signer = rows[0];
        if (signer.tokenEnc) {
            if (!this.secrets) throw Errors.Internal('Token sealing key unavailable');
            return openToken(signer.tokenEnc, signer.tenantId, this.secrets.jwtSecret, this.secrets.jwtSecretPrevious);
        }
        // Backfilled row — mint now and persist.
        if (!this.secrets) throw Errors.Internal('Token sealing key unavailable');
        const plaintext = mintToken();
        await db.update(agreementSigners)
            .set({ tokenHash: await hashToken(plaintext), tokenEnc: await sealToken(plaintext, signer.tenantId, this.secrets.jwtSecret) })
            .where(eq(agreementSigners.id, signerId));
        return plaintext;
    }

    /**
     * Track I-a Task 7 — server-side reconstruction of the combined-checkout
     * link for an inspection. Finds the latest non-terminal envelope for the
     * inspection, then its first non-terminal signer (pending / sent / viewed,
     * ordered by creation), and returns that signer's plaintext public token.
     * Returns null when there is no outstanding signer to route to (no envelope,
     * or every signer is already signed / declined / expired). The plaintext is
     * NEVER persisted — only the caller (a server-side link builder) sees it.
     */
    async getFirstOutstandingSignerLink(tenantId: string, inspectionId: string): Promise<string | null> {
        const db = this.getDrizzle();
        const envelope = await db.select().from(agreementRequests)
            .where(and(
                eq(agreementRequests.tenantId, tenantId),
                eq(agreementRequests.inspectionId, inspectionId),
                inArray(agreementRequests.status, ['pending', 'sent', 'viewed']),
            ))
            .orderBy(desc(agreementRequests.createdAt))
            .limit(1)
            .get();
        if (!envelope) return null;

        const outstanding = await db.select().from(agreementSigners)
            .where(and(
                eq(agreementSigners.requestId, envelope.id),
                inArray(agreementSigners.status, ['pending', 'sent', 'viewed']),
            ))
            .orderBy(asc(agreementSigners.createdAt))
            .limit(1)
            .get();
        if (!outstanding) return null;

        try {
            return await this.getSignerLink(envelope.id, outstanding.id);
        } catch (e) {
            logger.warn('AgreementService.getFirstOutstandingSignerLink failed', {
                tenantId, inspectionId, requestId: envelope.id, error: e instanceof Error ? e.message : String(e),
            });
            return null;
        }
    }

    /**
     * Marks a signer (resolved by presented token) as viewed and recomputes the
     * envelope aggregate (never downgrades). Null on miss / expired signer.
     * Idempotent.
     */
    async markViewedBySigner(presented: string): Promise<{ tenantId: string; inspectionId: string | null; agreementId: string; signerId: string } | null> {
        const db = this.getDrizzle();
        const resolved = await this.getSignerByPresentedToken(presented);
        if (!resolved) return null;
        const { signer, envelope } = resolved;
        if (signer.status === 'expired') return null;
        if (signer.status === 'pending' || signer.status === 'sent') {
            await db.update(agreementSigners)
                .set({ status: 'viewed', viewedAt: new Date() })
                .where(and(eq(agreementSigners.id, signer.id), inArray(agreementSigners.status, ['pending', 'sent'])));
            await this.recomputeEnvelope(envelope);
        }
        return { tenantId: envelope.tenantId, inspectionId: envelope.inspectionId, agreementId: envelope.agreementId, signerId: signer.id };
    }

    /**
     * Records a signer signature and rolls the envelope aggregate forward.
     * Mirrors legacy guards per SIGNER status: declined/expired → Conflict;
     * already-signed → idempotent (completedNow=false).
     */
    async markSignedBySigner(presented: string, signatureBase64: string, opts: {
        signedAtMs: number; channel: 'remote' | 'in_person'; ipAddress?: string | null; userAgent?: string | null;
        onBehalfOf?: string | null; onBehalfDisclaimer?: string | null;
    }): Promise<{ tenantId: string; inspectionId: string | null; requestId: string; signerId: string; envelopeCompletedNow: boolean; envelopeStatus: string }> {
        const db = this.getDrizzle();
        const resolved = await this.getSignerByPresentedToken(presented);
        if (!resolved) throw Errors.NotFound('Agreement request not found');
        const { signer, envelope } = resolved;
        if (signer.status === 'declined' || signer.status === 'expired') {
            throw Errors.Conflict('Agreement is no longer signable');
        }
        if (signer.status === 'signed') {
            return {
                tenantId: envelope.tenantId, inspectionId: envelope.inspectionId, requestId: envelope.id,
                signerId: signer.id, envelopeCompletedNow: false, envelopeStatus: envelope.status,
            };
        }
        await db.update(agreementSigners)
            .set({
                status: 'signed',
                signatureBase64,
                signedAt: new Date(opts.signedAtMs),
                channel: opts.channel,
                ipAddress: opts.ipAddress ?? null,
                userAgent: opts.userAgent ?? null,
                onBehalfOf: opts.onBehalfOf ?? null,
                onBehalfDisclaimer: opts.onBehalfDisclaimer ?? null,
            })
            .where(and(
                eq(agreementSigners.id, signer.id),
                sql`${agreementSigners.status} NOT IN ('signed','declined','expired')`,
            ));

        const previousStatus = envelope.status;
        const signers = await this.loadSigners(envelope.id);
        const aggregate = computeEnvelopeStatus(envelope.completionPolicy, signers);

        // Claim envelope completion ATOMICALLY. The in-memory `envelope.status`
        // snapshot is stale under concurrency (two sign calls — same signer
        // twice, or the last two signers of an 'all' envelope landing together —
        // can both compute aggregate==='signed' from the same snapshot). Deriving
        // `envelopeCompletedNow` from that snapshot lets BOTH writers report
        // completion → duplicate downstream notifications/emails (the workflow is
        // id-idempotent, but the other effects are not). Instead, gate completion
        // on the row count of a single conditional UPDATE that only one writer can
        // win: `WHERE status NOT IN (terminal)`.
        let envelopeCompletedNow = false;
        if (aggregate === 'signed') {
            const res: unknown = await db.update(agreementRequests)
                .set({
                    status: 'signed',
                    signedAt: new Date(opts.signedAtMs),
                    signatureBase64, // legacy reader compat
                })
                .where(and(
                    eq(agreementRequests.id, envelope.id),
                    sql`${agreementRequests.status} NOT IN ('signed','declined','expired')`,
                ));
            // Driver-tolerant row-count extraction: drizzle/d1 returns
            // `{ meta: { changes } }`; drizzle/better-sqlite3 (unit tests) returns
            // a top-level `{ changes }`. Empirically verified both shapes carry the count.
            const changes = (res as { meta?: { changes?: number } })?.meta?.changes
                ?? (res as { changes?: number })?.changes
                ?? 0;
            envelopeCompletedNow = changes > 0;
        } else if (!['signed', 'declined', 'expired'].includes(previousStatus) && aggregate !== previousStatus) {
            // Non-'signed' aggregate transitions (viewed). Also gated on a
            // conditional WHERE so a late writer can't clobber a terminal envelope.
            await db.update(agreementRequests)
                .set({ status: aggregate })
                .where(and(
                    eq(agreementRequests.id, envelope.id),
                    sql`${agreementRequests.status} NOT IN ('signed','declined','expired')`,
                ));
        }

        return {
            tenantId: envelope.tenantId, inspectionId: envelope.inspectionId, requestId: envelope.id,
            signerId: signer.id, envelopeCompletedNow, envelopeStatus: aggregate,
        };
    }

    /**
     * Marks a signer as declined and rolls the envelope aggregate. signed/expired
     * signer → Conflict; declined → idempotent. When the aggregate flips to
     * 'declined', the reason is stored on the envelope's lastError.
     */
    async markDeclinedBySigner(presented: string, reason?: string): Promise<{ tenantId: string; inspectionId: string | null; requestId: string; signerId: string; envelopeStatus: string }> {
        const db = this.getDrizzle();
        const resolved = await this.getSignerByPresentedToken(presented);
        if (!resolved) throw Errors.NotFound('Agreement request not found');
        const { signer, envelope } = resolved;
        if (signer.status === 'signed' || signer.status === 'expired') {
            throw Errors.Conflict('Agreement cannot be declined');
        }
        if (signer.status === 'declined') {
            return { tenantId: envelope.tenantId, inspectionId: envelope.inspectionId, requestId: envelope.id, signerId: signer.id, envelopeStatus: envelope.status };
        }
        await db.update(agreementSigners)
            .set({ status: 'declined' })
            .where(and(
                eq(agreementSigners.id, signer.id),
                sql`${agreementSigners.status} NOT IN ('signed','declined','expired')`,
            ));

        const previousStatus = envelope.status;
        const signers = await this.loadSigners(envelope.id);
        const aggregate = computeEnvelopeStatus(envelope.completionPolicy, signers);
        // Conditional WHERE (not just the in-memory `previousStatus` guard) so a
        // late decliner can't clobber an envelope another writer already drove
        // terminal under concurrency.
        if (!['signed', 'declined', 'expired'].includes(previousStatus) && aggregate !== previousStatus) {
            const patch: Partial<typeof agreementRequests.$inferInsert> = { status: aggregate };
            if (aggregate === 'declined' && reason) patch.lastError = reason.slice(0, 500);
            await db.update(agreementRequests).set(patch).where(and(
                eq(agreementRequests.id, envelope.id),
                sql`${agreementRequests.status} NOT IN ('signed','declined','expired')`,
            ));
        }

        return { tenantId: envelope.tenantId, inspectionId: envelope.inspectionId, requestId: envelope.id, signerId: signer.id, envelopeStatus: aggregate };
    }

    /** Recompute + persist the envelope aggregate (never downgrades a terminal envelope). */
    private async recomputeEnvelope(envelope: typeof agreementRequests.$inferSelect): Promise<string> {
        const db = this.getDrizzle();
        if (['signed', 'declined', 'expired'].includes(envelope.status)) return envelope.status;
        const signers = await this.loadSigners(envelope.id);
        const aggregate = computeEnvelopeStatus(envelope.completionPolicy, signers);
        if (aggregate !== envelope.status) {
            // Conditional WHERE so a late viewer can't downgrade an envelope that
            // another concurrent writer already drove terminal (the in-memory
            // `envelope.status` snapshot is not authoritative under concurrency).
            await db.update(agreementRequests).set({ status: aggregate }).where(and(
                eq(agreementRequests.id, envelope.id),
                sql`${agreementRequests.status} NOT IN ('signed','declined','expired')`,
            ));
        }
        return aggregate;
    }

    /**
     * Returns the agreement content + hash for an envelope. Prefers the pinned
     * snapshot; on a pre-0020 NULL snapshot, loads the live template and (when
     * the envelope is still non-terminal) lazily persists it to self-heal.
     */
    async getSnapshotForRequest(request: typeof agreementRequests.$inferSelect): Promise<{ content: string; hash: string | null }> {
        if (request.contentSnapshot != null) {
            return { content: request.contentSnapshot, hash: request.contentHash };
        }
        const db = this.getDrizzle();
        const agr = await db.select().from(agreements).where(eq(agreements.id, request.agreementId)).limit(1);
        if (agr.length === 0) throw Errors.NotFound('Agreement not found');
        const content = agr[0].content;
        const hash = await sha256Hex(content);
        if (['pending', 'sent', 'viewed'].includes(request.status)) {
            await db.update(agreementRequests)
                .set({ contentSnapshot: content, contentHash: hash })
                .where(eq(agreementRequests.id, request.id));
        }
        return { content, hash };
    }
}

/**
 * Spec 5H D1 — Inspector pre-sign.
 *
 * Writes the inspector's signature, userId, and timestamp onto the
 * agreement request row while it is still in 'pending' status (before
 * it is sent to the client). Tenant-scoped; throws if the envelope is
 * not found, belongs to a different tenant, or is not in 'pending' status.
 */
export async function applyInspectorPreSign(
    d1: D1Database,
    tenantId: string,
    envelopeId: string,
    inspectorUserId: string,
    signatureBase64: string,
): Promise<void> {
    const db = drizzle(d1, { schema });
    const row = await db.select().from(schema.agreementRequests)
        .where(and(
            eq(schema.agreementRequests.id, envelopeId),
            eq(schema.agreementRequests.tenantId, tenantId),
        )).get();
    if (!row) throw new Error('agreement request not found');
    if (row.status !== 'pending') {
        throw new Error('can only pre-sign while status is pending');
    }
    await db.update(schema.agreementRequests)
        .set({
            inspectorSignatureBase64: signatureBase64,
            inspectorSignedAt: new Date(),
            inspectorUserId,
        })
        .where(eq(schema.agreementRequests.id, envelopeId));
}
