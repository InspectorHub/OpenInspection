import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { tenants, users } from '../db/schema';
import { IntegrationProvider, TenantUpdateParams } from '../integration';

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
        const { id, subdomain, status, tier, name, adminEmail, adminPasswordHash } = params;

        // Upsert tenant
        const existingTenant = await db.select()
            .from(tenants)
            .where(eq(tenants.subdomain, subdomain))
            .get();

        if (!existingTenant) {
            await db.insert(tenants).values({
                id: id || crypto.randomUUID(),
                subdomain,
                name: name || subdomain,
                status: (status as 'active' | 'suspended' | 'trial') || 'active',
                tier: (tier as 'free' | 'pro' | 'enterprise') || 'free',
                createdAt: new Date(),
            });
        } else {
            await db.update(tenants)
                .set({
                    status: (status as 'active' | 'suspended' | 'trial') || existingTenant.status,
                    tier: (tier as 'free' | 'pro' | 'enterprise') || existingTenant.tier,
                    name: name || existingTenant.name,
                })
                .where(eq(tenants.subdomain, subdomain));
        }

        // Handle Admin Sync if provided
        if (adminEmail && adminPasswordHash) {
            const finalTenantId = id || existingTenant?.id;
            if (!finalTenantId) {
                console.error('Cannot sync admin: No tenant ID resolved');
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
