import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { tenantConfigs } from '../lib/db/schema';
import { Errors } from '../lib/errors';
import { encryptSecrets, decryptSecrets, maskSecret, isMasked } from '../lib/config-crypto';

export interface IntegrationConfig {
    appBaseUrl?: string;
    turnstileSiteKey?: string;
    googleClientId?: string;
}

export interface SecretsConfig {
    resendApiKey?: string;
    turnstileSecretKey?: string;
    geminiApiKey?: string;
    googleClientSecret?: string;
}

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
    async getBranding(tenantId: string, defaults: { siteName: string; primaryColor: string; supportEmail: string }) {
        const db = this.getDrizzle();
        const config = await db.select().from(tenantConfigs).where(eq(tenantConfigs.tenantId, tenantId)).get();

        return config ?? {
            siteName: defaults.siteName,
            primaryColor: defaults.primaryColor,
            logoUrl: null,
            supportEmail: defaults.supportEmail,
            billingUrl: '',
            gaMeasurementId: ''
        };
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
        const key = `branding/${tenantId}/logo-${Date.now()}.${extension}`;

        await this.r2.put(key, await file.arrayBuffer(), {
            httpMetadata: { contentType: file.type },
        });

        const logoUrl = `/api/inspections/photo/${key}`;
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

    // ─── Secrets (AES-256-GCM encrypted) ────────────────────────────────────

    /**
     * Returns decrypted secrets for internal service use.
     * Never call this in an API response — use getMaskedSecrets instead.
     */
    async getDecryptedSecrets(tenantId: string, jwtSecret: string): Promise<SecretsConfig> {
        const db = this.getDrizzle();
        const row = await db
            .select({ secrets: tenantConfigs.secrets })
            .from(tenantConfigs)
            .where(eq(tenantConfigs.tenantId, tenantId))
            .get();

        if (!row?.secrets) return {};
        try {
            return await decryptSecrets(row.secrets, jwtSecret) as SecretsConfig;
        } catch {
            return {};
        }
    }

    /**
     * Returns masked secrets safe for API responses.
     * e.g. { resendApiKey: "re_1••••••••abcd" }
     */
    async getMaskedSecrets(tenantId: string, jwtSecret: string): Promise<Record<string, string>> {
        const secrets = await this.getDecryptedSecrets(tenantId, jwtSecret);
        return Object.fromEntries(
            Object.entries(secrets).map(([k, v]) => [k, maskSecret(v)])
        );
    }

    /**
     * Merges and saves secrets (encrypted). Skips fields that contain mask characters
     * (i.e. the frontend sent back the masked display value — field not changed).
     */
    async updateSecrets(tenantId: string, jwtSecret: string, newData: Partial<SecretsConfig>): Promise<void> {
        const existing = await this.getDecryptedSecrets(tenantId, jwtSecret);

        // Filter out masked/empty values — those mean "no change"
        const updates = Object.fromEntries(
            Object.entries(newData).filter(([, v]) => v && !isMasked(v))
        );

        if (Object.keys(updates).length === 0) return;

        const merged = { ...existing, ...updates };
        const encrypted = await encryptSecrets(
            Object.fromEntries(Object.entries(merged).filter(([, v]) => v)) as Record<string, string>,
            jwtSecret
        );
        await this.updateBranding(tenantId, { secrets: encrypted });
    }
}
