import { eq, and } from 'drizzle-orm';
import { inspections } from '../../lib/db/schema';
import { Errors } from '../../lib/errors';
import { InspectionSubService } from './base';

/**
 * Agent view token sharing — generates + resolves the 30-day KV-backed
 * read-only report tokens. Extracted verbatim from InspectionService.
 */
export class InspectionSharingService extends InspectionSubService {
    /**
     * Generates a 30-day shareable agent view token stored in KV.
     * The token grants read-only access to the report without requiring login.
     */
    async generateAgentViewToken(tenantId: string, inspectionId: string): Promise<string> {
        const db = this.getDrizzle();
        const rows = await db.select({ id: inspections.id })
            .from(inspections)
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)))
            .limit(1);
        if (!rows[0]) throw Errors.NotFound('Inspection not found');
        if (!this.kv) throw Errors.Internal('KV not available');

        const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
        await this.kv.put(`agent_view_token:${token}`, `${inspectionId}:${tenantId}`, {
            expirationTtl: 30 * 24 * 60 * 60,
        });
        return token;
    }

    /**
     * Resolves an agent view token from KV.
     */
    async resolveAgentViewToken(token: string): Promise<{ inspectionId: string; tenantId: string } | null> {
        if (!this.kv) return null;
        const val = await this.kv.get(`agent_view_token:${token}`);
        if (!val) return null;
        const [inspectionId, tenantId] = val.split(':');
        return { inspectionId, tenantId };
    }
}
