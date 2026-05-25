import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { tenants, users, recommendations } from '../db/schema';
import { IntegrationProvider, TenantUpdateParams } from '../integration';
import { logger } from '../logger';
import { RECOMMENDATION_SEEDS } from '../../data/recommendation-seeds';

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
        const { id, subdomain, status, tier, name, maxUsers, adminEmail, adminPasswordHash } = params;

        // Upsert tenant
        const existingTenant = await db.select()
            .from(tenants)
            .where(eq(tenants.subdomain, subdomain))
            .get();

        if (!existingTenant) {
            const newTenantId = id || crypto.randomUUID();
            await db.insert(tenants).values({
                id: newTenantId,
                subdomain,
                name: name || subdomain,
                status: (status as 'active' | 'suspended' | 'trial') || 'active',
                tier: (tier as 'free' | 'pro' | 'enterprise') || 'free',
                ...(maxUsers != null ? { maxUsers } : {}),
                createdAt: new Date(),
            });

            // Auto-seed default recommendations library for the new tenant
            try {
                for (const seed of RECOMMENDATION_SEEDS) {
                    await db.insert(recommendations).values({
                        id: crypto.randomUUID(),
                        tenantId: newTenantId,
                        category: seed.category ?? null,
                        name: seed.name,
                        severity: seed.severity,
                        defaultEstimateMin: seed.defaultEstimateMin ?? null,
                        defaultEstimateMax: seed.defaultEstimateMax ?? null,
                        defaultRepairSummary: seed.defaultRepairSummary,
                        createdByUserId: null,
                        createdAt: new Date(),
                    });
                }
            } catch (seedErr) {
                logger.error('Auto-seed recommendations failed in portal provider', { tenantId: newTenantId }, seedErr instanceof Error ? seedErr : undefined);
            }

            // Spec 4D — Auto-seed default event types
            try {
                const { EventService } = await import('../../services/event.service');
                const eventSvc = new EventService(this.db);
                await eventSvc.bulkSeed(newTenantId);
            } catch (seedErr) {
                logger.error('Auto-seed event types failed in portal provider', { tenantId: newTenantId }, seedErr instanceof Error ? seedErr : undefined);
            }

            // Spec 4F — Auto-seed default 6 templates
            try {
                const { TemplateSeedService } = await import('../../services/template-seed.service');
                const seedSvc = new TemplateSeedService(this.db);
                await seedSvc.bulkSeed(newTenantId);
            } catch (seedErr) {
                logger.error('Auto-seed templates failed in portal provider', { tenantId: newTenantId }, seedErr instanceof Error ? seedErr : undefined);
            }
        } else {
            await db.update(tenants)
                .set({
                    status: (status as 'active' | 'suspended' | 'trial') || existingTenant.status,
                    tier: (tier as 'free' | 'pro' | 'enterprise') || existingTenant.tier,
                    name: name || existingTenant.name,
                    ...(maxUsers != null ? { maxUsers } : {}),
                })
                .where(eq(tenants.subdomain, subdomain));
        }

        // Handle Admin Sync if provided
        if (adminEmail && adminPasswordHash) {
            const finalTenantId = id || existingTenant?.id;
            if (!finalTenantId) {
                logger.error('Cannot sync admin: No tenant ID resolved');
                return;
            }

            const existingUser = await db.select()
                .from(users)
                .where(eq(users.email, adminEmail))
                .get();

            if (!existingUser) {
                await db.insert(users).values({
                    id: crypto.randomUUID(),
                    tenantId: finalTenantId,
                    email: adminEmail,
                    passwordHash: adminPasswordHash,
                    role: 'owner',
                    createdAt: new Date(),
                });
            } else {
                await db.update(users)
                    .set({ 
                        passwordHash: adminPasswordHash,
                        tenantId: finalTenantId // Ensure it's correctly linked
                    })
                    .where(eq(users.id, existingUser.id));
            }
        }

        // Clear cache if KV exists
        if (this.kv) {
            // Standardized key matched with tenant-router.ts
            await this.kv.delete(`tenant:${subdomain}`);
        }
    }

    async handleStripeConnect(subdomain: string, accountId: string): Promise<void> {
        const db = this.getDrizzle();
        await db.update(tenants)
            .set({ stripeConnectAccountId: accountId })
            .where(eq(tenants.subdomain, subdomain));
        
        if (this.kv) {
            await this.kv.delete(`tenant:${subdomain}`);
        }
    }

}
