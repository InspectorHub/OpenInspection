import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { tenantConfigs, auditLogs } from '../lib/db/schema';

/**
 * Manages the embeddable booking widget's per-tenant configuration:
 *   - allowed origin list (cross-origin allowlist for the widget iframe)
 *   - event logging (view / submit / success — written to audit_logs)
 *
 * Origin matching:
 *   - exact:    "https://acme.com"          matches "https://acme.com"
 *   - wildcard: "https://*.acme.com"        matches "https://shop.acme.com" but NOT "https://acme.com"
 *   - protocol mismatch (http vs https) is treated as a non-match
 */
export class WidgetService {
    constructor(private d1: D1Database) {}

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private db() { return drizzle(this.d1 as any); }

    async getAllowedOrigins(tenantId: string): Promise<string[]> {
        const row = await this.db()
            .select({ widgetAllowedOrigins: tenantConfigs.widgetAllowedOrigins })
            .from(tenantConfigs)
            .where(eq(tenantConfigs.tenantId, tenantId))
            .get();
        return row?.widgetAllowedOrigins ?? [];
    }

    async setAllowedOrigins(tenantId: string, origins: string[]): Promise<void> {
        // Validate each is a syntactically valid URL with http/https only
        for (const o of origins) {
            const wildcardCount = (o.match(/\*/g) || []).length;
            if (wildcardCount > 1) {
                throw new Error(`Origin pattern may contain at most one wildcard: ${o}`);
            }
            // Validate as URL (replace `*` placeholder so URL constructor accepts it).
            // CodeQL js/incomplete-sanitization — replaceAll for safety even though
            // wildcardCount<=1 is already enforced above.
            try {
                const u = new URL(o.replaceAll('*', 'wildcard'));
                if (u.protocol !== 'http:' && u.protocol !== 'https:') {
                    throw new Error(`Origin must be http or https: ${o}`);
                }
            } catch {
                throw new Error(`Invalid origin URL: ${o}`);
            }
        }
        const db = this.db();
        const existing = await db.select().from(tenantConfigs).where(eq(tenantConfigs.tenantId, tenantId)).get();
        if (existing) {
            await db.update(tenantConfigs)
                .set({ widgetAllowedOrigins: origins, updatedAt: new Date() })
                .where(eq(tenantConfigs.tenantId, tenantId));
        } else {
            await db.insert(tenantConfigs).values({ tenantId, widgetAllowedOrigins: origins, updatedAt: new Date() });
        }
    }

    async isOriginAllowed(tenantId: string, origin: string | null | undefined): Promise<boolean> {
        if (!origin) return false;
        const allowed = await this.getAllowedOrigins(tenantId);
        if (allowed.length === 0) return false;
        const normalizedOrigin = origin.replace(/\/$/, '').toLowerCase();
        return allowed.some(pattern => matchOrigin(pattern.replace(/\/$/, '').toLowerCase(), normalizedOrigin));
    }

    /**
     * Logs a widget event to audit_logs. Event names: 'view' | 'submit' | 'success' | 'error'
     * Becomes audit_logs.action = 'widget.{event}'.
     */
    async recordEvent(tenantId: string, event: string, metadata: Record<string, unknown> = {}): Promise<void> {
        await this.db().insert(auditLogs).values({
            id: crypto.randomUUID(),
            tenantId,
            userId: null,
            action: `widget.${event}`,
            entityType: 'widget',
            entityId: null,
            metadata,
            ipAddress: (metadata.ip as string) ?? null,
            createdAt: new Date(),
        });
    }
}

/**
 * Match a single origin pattern against a candidate origin string.
 * Wildcard `*` may appear ONCE in the host portion (e.g. `https://*.acme.com`).
 */
function matchOrigin(pattern: string, candidate: string): boolean {
    if (!pattern.includes('*')) return pattern === candidate;
    try {
        // CodeQL js/incomplete-sanitization — replaceAll for both substitutions.
        // Also escape ALL regex metacharacters in hostname (not just `.`) before
        // injecting the wildcard placeholder.
        const pUrl = new URL(pattern.replaceAll('*', 'wildcard'));
        const cUrl = new URL(candidate);
        if (pUrl.protocol !== cUrl.protocol) return false;
        if (pUrl.port !== cUrl.port) return false;
        const escaped = pUrl.hostname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const hostRegex = new RegExp('^' + escaped.replaceAll('wildcard', '[^.]+') + '$');
        return hostRegex.test(cUrl.hostname);
    } catch {
        return false;
    }
}
