import { eq, and } from 'drizzle-orm';
import { inspections } from '../../lib/db/schema';
import { Errors } from '../../lib/errors';
import { InspectionSubService } from './base';
import { mintAgentViewToken } from '../../lib/agent-view-token';

/** The role a share token acts in: `agent` (the agent report view and the repair builder's agent seat) or `client` (view only). */
export type AgentViewTokenRole = 'agent' | 'client';

/**
 * Agent view token sharing — generates + resolves the 30-day KV-backed
 * read-only report tokens. Extracted verbatim from InspectionService.
 *
 * SUNSET: this KV token is a bridge from before per-recipient portal tokens. The 30-day lifetime stays. It will be removed
 * once no unexpired token can exist (30 days after the last release that mints one) and the staff share routes issue portal
 * tokens instead; see docs/operate/legacy-share-tokens.md. Until then a token carries the role of whoever it was minted for
 * (the KV value is `inspectionId:tenantId:role`; a value without a role was minted before this and counts as `agent`), and is
 * only honoured for the one inspection it names.
 */
export class InspectionSharingService extends InspectionSubService {
    /**
     * Generates a 30-day shareable agent view token stored in KV.
     * The token grants read-only access to the report without requiring login.
     */
    async generateAgentViewToken(tenantId: string, inspectionId: string, role: AgentViewTokenRole = 'agent'): Promise<string> {
        const db = this.getDrizzle();
        const rows = await db.select({ id: inspections.id })
            .from(inspections)
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)))
            .limit(1);
        if (!rows[0]) throw Errors.NotFound('Inspection not found');
        if (!this.kv) throw Errors.Internal('KV not available');

        // The tenant rides in the leading 32 characters so a tenant purge can
        // enumerate these by prefix — see lib/agent-view-token.ts for why it is
        // the token and not the key that carries it.
        const token = mintAgentViewToken(tenantId);
        await this.kv.put(`agent_view_token:${token}`, `${inspectionId}:${tenantId}:${role}`, {
            expirationTtl: 30 * 24 * 60 * 60,
        });
        return token;
    }

    /**
     * Resolves an agent view token from KV.
     */
    async resolveAgentViewToken(token: string): Promise<{ inspectionId: string; tenantId: string; role: AgentViewTokenRole } | null> {
        if (!this.kv) return null;
        const val = await this.kv.get(`agent_view_token:${token}`);
        if (!val) return null;
        const [inspectionId, tenantId, storedRole] = val.split(':');
        if (!inspectionId || !tenantId) return null;
        // A value minted before roles existed has none: those links were all staff-issued agent links.
        const role = storedRole === undefined ? 'agent' : storedRole;
        if (role !== 'agent' && role !== 'client') return null;
        return { inspectionId, tenantId, role };
    }
}
