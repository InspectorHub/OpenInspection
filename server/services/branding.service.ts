import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { tenantConfigs } from '../lib/db/schema';
import { Errors } from '../lib/errors';
import type { EmailIdentityConfig } from '../lib/email/sender-identity';
import { r2Keys } from '../lib/r2-keys';

export interface IntegrationConfig {
    appBaseUrl?: string;
    turnstileSiteKey?: string;
    googleClientId?: string;
    /** SaaS: platform Worker OAuth app (default) vs tenant BYO Google OAuth app. */
    googleOAuthMode?: 'platform' | 'own';
    /** Cloudflare Stream customer subdomain for the self-host Stream video backend. */
    streamCustomerSubdomain?: string;
}

// C-15 (2026-06-06): the legacy `SecretsConfig` shape (camelCase keys in the
// retired `tenant_configs.secrets` column) is GONE. Tenant secrets live solely
// in `secrets_enc` (ENV-name keys; server/api/secrets.ts +
// lib/secrets-cache.ts + lib/middleware/integration-secrets.ts).

/**
 * Service to handle tenant-specific branding and configuration.
 * Also manages integration config (plaintext) and secrets (AES-GCM encrypted).
 */
export class BrandingService {
    constructor(private db: D1Database, private kv?: KVNamespace, private r2?: R2Bucket) {}

    private getDrizzle() {
        return drizzle(this.db);
    }

    /**
     * Fetches the current branding configuration for a tenant.
     */
    async getBranding(tenantId: string, defaults: { companyName: string; primaryColor: string; supportEmail: string }) {
        const db = this.getDrizzle();
        const config = await db.select().from(tenantConfigs).where(eq(tenantConfigs.tenantId, tenantId)).get();

        return config ?? {
            companyName: defaults.companyName,
            primaryColor: defaults.primaryColor,
            logoUrl: null,
            supportEmail: defaults.supportEmail,
            billingUrl: '',
            defaultTimezone: 'UTC'
        };
    }

    /**
     * Phase 1 (B-4/A-7) — load just the email-identity columns for a tenant.
     * Returns platform defaults when no config row exists.
     */
    async getEmailIdentity(tenantId: string): Promise<EmailIdentityConfig> {
        const db = this.getDrizzle();
        const row = await db
            .select({
                emailMode: tenantConfigs.emailMode,
                senderEmail: tenantConfigs.senderEmail,
                replyTo: tenantConfigs.replyTo,
                senderDisplayName: tenantConfigs.senderDisplayName,
                pointOfContact: tenantConfigs.pointOfContact,
                companyName: tenantConfigs.companyName,
            })
            .from(tenantConfigs)
            .where(eq(tenantConfigs.tenantId, tenantId))
            .get();
        return {
            mode: row?.emailMode ?? 'platform',
            senderEmail: row?.senderEmail ?? null,
            replyTo: row?.replyTo ?? null,
            senderDisplayName: row?.senderDisplayName ?? null,
            pointOfContact: row?.pointOfContact ?? 'company',
            companyName: row?.companyName ?? null,
        };
    }

    /**
     * A-10 — the canonical tenant brand projection every tenant-facing surface
     * (profile / booking / report / invoice / email) paints with.
     * Returns nulls when no config row exists; callers apply platform fallbacks.
     */
    async getBrand(tenantId: string): Promise<{ companyName: string | null; logoUrl: string | null; primaryColor: string | null }> {
        const db = this.getDrizzle();
        const row = await db
            .select({ companyName: tenantConfigs.companyName, logoUrl: tenantConfigs.logoUrl, primaryColor: tenantConfigs.primaryColor })
            .from(tenantConfigs)
            .where(eq(tenantConfigs.tenantId, tenantId))
            .get();
        return {
            companyName: row?.companyName ?? null,
            logoUrl: row?.logoUrl ?? null,
            primaryColor: row?.primaryColor ?? null,
        };
    }

    /**
     * Email-template Phase 2 — the brand the email layout paints with.
     * Same projection as getBrand (kept as the email-path entry point).
     */
    async getEmailBrand(tenantId: string): Promise<{ companyName: string | null; logoUrl: string | null; primaryColor: string | null }> {
        return this.getBrand(tenantId);
    }

    /**
     * Resolves the effective report theme for an inspection.
     * Per-report override wins; otherwise falls back to tenant default; otherwise 'modern'.
     */
    resolveReportTheme(
        inspection: { reportThemeOverride?: string | null },
        branding?: { reportTheme?: string | undefined }
    ): 'modern' | 'classic' | 'minimal' {
        return (inspection.reportThemeOverride ?? branding?.reportTheme ?? 'modern') as 'modern' | 'classic' | 'minimal';
    }

    /**
     * Updates the branding configuration for a tenant.
     */
    async updateBranding(tenantId: string, data: Partial<typeof tenantConfigs.$inferInsert>) {
        const db = this.getDrizzle();
        const existing = await db.select().from(tenantConfigs).where(eq(tenantConfigs.tenantId, tenantId)).get();

        const updateData = { ...data, tenantId, updatedAt: new Date() };

        if (existing) {
            await db.update(tenantConfigs).set(updateData).where(eq(tenantConfigs.tenantId, tenantId));
        } else {
            await db.insert(tenantConfigs).values(updateData as typeof tenantConfigs.$inferInsert);
        }

        if (this.kv) {
            await this.kv.delete(`branding:${tenantId}`);
        }

        return updateData;
    }

    /**
     * Uploads a logo to R2 and updates the tenant configuration.
     */
    async uploadLogo(tenantId: string, file: File) {
        if (!this.r2) throw Errors.BadRequest('Logo upload not available');

        const extension = file.type.split('/')[1] === 'svg+xml' ? 'svg' : file.type.split('/')[1];
        const key = r2Keys.brandingLogo(tenantId, crypto.randomUUID(), extension);

        await this.r2.put(key, await file.arrayBuffer(), {
            httpMetadata: { contentType: file.type },
        });

        // A-10 — point at the public brand-asset serve route (the previous
        // `/api/inspections/photo/${key}` path never had a handler). The R2
        // key contains '/', so it travels as a query param (Hono mounted
        // routers don't match multi-segment path params).
        const logoUrl = `/api/public/brand-asset?key=${encodeURIComponent(key)}`;
        await this.updateBranding(tenantId, { logoUrl });

        return logoUrl;
    }

    // ─── Integration Config (plaintext non-sensitive) ────────────────────────

    /** Returns stored integration config (appBaseUrl, turnstileSiteKey, googleClientId). */
    async getIntegrationConfig(tenantId: string): Promise<IntegrationConfig> {
        const db = this.getDrizzle();
        const row = await db
            .select({ integrationConfig: tenantConfigs.integrationConfig })
            .from(tenantConfigs)
            .where(eq(tenantConfigs.tenantId, tenantId))
            .get();

        if (!row?.integrationConfig) return {};
        try {
            return JSON.parse(row.integrationConfig) as IntegrationConfig;
        } catch {
            return {};
        }
    }

    /** Merges and saves integration config. */
    async updateIntegrationConfig(tenantId: string, data: Partial<IntegrationConfig>): Promise<void> {
        const existing = await this.getIntegrationConfig(tenantId);
        const merged = { ...existing, ...data };
        // Remove empty values
        const cleaned = Object.fromEntries(Object.entries(merged).filter(([, v]) => v != null && v !== ''));
        await this.updateBranding(tenantId, { integrationConfig: JSON.stringify(cleaned) });
    }

    // C-15 (2026-06-06): getDecryptedSecrets / getMaskedSecrets / updateSecrets
    // were RETIRED with the legacy `tenant_configs.secrets` dual store (the
    // A-16 wrong-store bug came from exactly this duality). Reads + writes go
    // through the canonical `secrets_enc` column only.
}
