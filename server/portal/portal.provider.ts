import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { tenants, tenantConfigs } from '../lib/db/schema';
import { IntegrationProvider, TenantUpdateParams } from '../lib/integration';
import { logger } from '../lib/logger';
import { applyAdminCredential } from './admin-credential';

/**
 * Portal implementation of IntegrationProvider.
 * Used in the SaaS version where Core is tightly coupled with the SaaS Portal.
 */
export class PortalProvider implements IntegrationProvider {
    constructor(private db: D1Database, private kv?: KVNamespace) {}

    private getDrizzle() {
        return drizzle(this.db);
    }

    async handleTenantUpdate(params: TenantUpdateParams): Promise<void> {
        const db = this.getDrizzle();
        const { id, slug, status, tier, name, maxUsers, adminEmail, adminPasswordHash } = params;

        // Upsert keyed on the STABLE tenant id (core's tenant id IS portal's
        // tenantId — every provisioning sync passes it as `id`), falling back to
        // slug only when no id is supplied. Keying on id lets an existing row
        // self-heal its slug on the next sync (e.g. the 2026-06-03 subdomain→slug
        // migration changed the public key from a UUID to a human slug) instead
        // of inserting a duplicate.
        const existingTenant = (id
            ? await db.select().from(tenants).where(eq(tenants.id, id)).get()
            : undefined)
            ?? await db.select().from(tenants).where(eq(tenants.slug, slug)).get();

        if (!existingTenant) {
            const newTenantId = id || crypto.randomUUID();
            await db.insert(tenants).values({
                id: newTenantId,
                slug,
                name: name || slug,
                status: (status as 'active' | 'suspended' | 'trial') || 'active',
                tier: (tier as 'free' | 'pro' | 'enterprise') || 'free',
                ...(maxUsers != null ? { maxUsers } : {}),
                createdAt: new Date(),
            });

            // Starter content (templates, comments, recommendations, rating
            // systems, marketplace, …) is seeded by the portal OnboardingWorkflow's
            // dedicated `seed-starter-content` step, which calls
            // POST /api/admin/seed-starter-content -> seedStarterContent right
            // after this sync. That seeder is idempotent, batched, and complete,
            // so we no longer partial-seed here (it used to duplicate a subset).
        } else {
            await db.update(tenants)
                .set({
                    // Correct the slug too — heals a stale (e.g. legacy UUID) slug
                    // when the row was matched by id.
                    slug,
                    status: (status as 'active' | 'suspended' | 'trial') || existingTenant.status,
                    tier: (tier as 'free' | 'pro' | 'enterprise') || existingTenant.tier,
                    name: name || existingTenant.name,
                    ...(maxUsers != null ? { maxUsers } : {}),
                })
                .where(eq(tenants.id, existingTenant.id));
            // Drop the stale-slug cache entry too (the row may have just changed slug).
            if (this.kv && existingTenant.slug !== slug) await this.kv.delete(`tenant:${existingTenant.slug}`);
        }

        // IA-27: initialize tenant_configs.companyName from the company name so the
        // brand never boots as the platform default. This is initialize-only —
        // if the tenant has already chosen a site name we leave it untouched.
        if (name) {
            const finalTenantId = id || existingTenant?.id;
            if (finalTenantId) {
                const cfg = await db.select().from(tenantConfigs).where(eq(tenantConfigs.tenantId, finalTenantId)).get();
                if (!cfg) {
                    await db.insert(tenantConfigs).values({
                        tenantId: finalTenantId,
                        companyName: name,
                        updatedAt: new Date(),
                    });
                } else if (!cfg.companyName) {
                    await db.update(tenantConfigs)
                        .set({ companyName: name, updatedAt: new Date() })
                        .where(eq(tenantConfigs.tenantId, finalTenantId));
                }
                // companyName already set → leave it (initialize-only, never overwrite)
            }
        }

        // Handle Admin Sync if provided
        if (adminEmail && adminPasswordHash) {
            const finalTenantId = id || existingTenant?.id;
            if (!finalTenantId) {
                logger.error('Cannot sync admin: No tenant ID resolved');
                return;
            }
            await applyAdminCredential(this.db, {
                tenantId: finalTenantId,
                adminEmail,
                adminPasswordHash,
            });
        }

        // Clear cache if KV exists
        if (this.kv) {
            // Standardized key matched with tenant-router.ts
            await this.kv.delete(`tenant:${slug}`);
        }
    }

}
