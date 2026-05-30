import { drizzle } from 'drizzle-orm/d1';
import { eq, and, inArray, sql, desc } from 'drizzle-orm';
import { agreements, agreementRequests, inspections } from '../lib/db/schema';
import * as schema from '../lib/db/schema';
import { Errors } from '../lib/errors';
import { logger } from '../lib/logger';

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
    constructor(private db: D1Database) {}

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
    async findPendingByInspectionId(tenantId: string, inspectionId: string): Promise<{ token: string; status: string } | null> {
        const row = await this.getDrizzle().select({
            token:  agreementRequests.token,
            status: agreementRequests.status,
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
    async findOrCreate(tenantId: string, inspectionId: string): Promise<{ token: string; status: string; alreadyExists: boolean }> {
        const db = this.getDrizzle();
        // Look for an existing non-terminal request
        const existing = await db.select().from(agreementRequests)
            .where(and(
                eq(agreementRequests.tenantId, tenantId),
                eq(agreementRequests.inspectionId, inspectionId),
                inArray(agreementRequests.status, ['pending', 'sent', 'viewed']),
            )).limit(1);
        if (existing.length > 0) {
            return { token: existing[0].token, status: existing[0].status, alreadyExists: true };
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
        // Insert new agreement_request row
        const token = crypto.randomUUID();
        const now = new Date();
        const newRow = {
            id: crypto.randomUUID(),
            tenantId,
            inspectionId,
            agreementId: agreement.id,
            clientEmail: insp.clientEmail || '',
            clientName: insp.clientName,
            token,
            status: 'sent' as const,
            signatureBase64: null,
            signedAt: null,
            viewedAt: null,
            sentAt: now,
            lastError: null,
            createdAt: now,
        };
        await db.insert(agreementRequests).values(newRow);
        logger.info('AgreementService.findOrCreate created', { tenantId, inspectionId, token });
        return { token, status: 'sent', alreadyExists: false };
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
        // Use epoch milliseconds integer directly — better-sqlite3 cannot bind Date objects
        // in comparison expressions, but D1 also expects an integer for timestamp columns.
        const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
        await db.update(agreementRequests)
            .set({ status: 'expired' })
            .where(and(
                inArray(agreementRequests.status, ['pending', 'sent', 'viewed']),
                sql`${agreementRequests.sentAt} < ${cutoffMs}`,
            ));
        // D1/Drizzle does not expose rowsAffected; count expired rows within the cutoff window
        const expiredRows = await db.select().from(agreementRequests)
            .where(and(
                eq(agreementRequests.status, 'expired'),
                sql`${agreementRequests.sentAt} < ${cutoffMs}`,
            ));
        const count = expiredRows.length;
        logger.info('AgreementService.expireOlderThan', { days, count });
        return count;
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
