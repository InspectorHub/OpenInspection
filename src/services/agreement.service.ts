import { drizzle } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import { agreements, agreementRequests } from '../lib/db/schema';
import { Errors } from '../lib/errors';

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
    out = out.replace(/<!--[\s\S]*?-->/g, '');

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
    out = out.replace(/\s+on\w+\s*=\s*"[^"]*"/gi, '').replace(/\s+on\w+\s*=\s*'[^']*'/gi, '');

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
     * Marks a signing request as viewed (idempotent, no pre-SELECT needed).
     */
    async markViewed(token: string) {
        await this.getDrizzle()
            .update(agreementRequests)
            .set({ status: 'viewed', viewedAt: new Date() })
            .where(and(eq(agreementRequests.token, token), eq(agreementRequests.status, 'pending')));
    }

    /**
     * Records a client signature on a signing request.
     */
    async signRequest(token: string, signatureBase64: string) {
        const request = await this.getRequestByToken(token);
        if (!request) throw Errors.NotFound('Signing request not found');
        if (request.status === 'signed') throw Errors.Conflict('Agreement already signed');

        await this.getDrizzle()
            .update(agreementRequests)
            .set({ status: 'signed', signatureBase64, signedAt: new Date() })
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
}
