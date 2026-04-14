import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { tenants, users, templates } from '../db/schema';
import { IntegrationProvider, TenantUpdateParams } from '../integration';

/**
 * Standalone implementation of IntegrationProvider.
 * Used in the open-source version where Core is managed directly or via local CLI/Admin UI.
 */
export class StandaloneProvider implements IntegrationProvider {
    constructor(private db: D1Database, private kv?: KVNamespace) {}

    private getDrizzle() {
        return drizzle(this.db);
    }

    async handleTenantUpdate(params: TenantUpdateParams): Promise<void> {
        const db = this.getDrizzle();
        const { id, subdomain, status, tier, name, deploymentMode, adminEmail, adminPasswordHash } = params;

        let tenantId = id || crypto.randomUUID();
        const existingTenant = await db.select().from(tenants).where(eq(tenants.subdomain, subdomain)).get();

        if (!existingTenant) {
            await db.insert(tenants).values({
                id: tenantId,
                name: name || subdomain,
                subdomain,
                tier: tier || 'free',
                status: (adminEmail ? 'active' : status) || 'pending',
                deploymentMode: deploymentMode || 'silo', // Default to silo for OS
                createdAt: new Date(),
            });
        } else {
            tenantId = existingTenant.id;
            const update: Record<string, string | Date> = { 
                status: (adminEmail ? 'active' : status) || 'pending' 
            };
            if (tier) update.tier = tier;
            if (deploymentMode) update.deploymentMode = deploymentMode;
            if (name) update.name = name;
            
            await db.update(tenants).set(update).where(eq(tenants.subdomain, subdomain));
        }

        // Handle Admin User creation/sync
        if (adminEmail && adminPasswordHash) {
            const existingUser = await db.select().from(users).where(eq(users.email, adminEmail)).get();
            if (!existingUser) {
                const now = new Date();
                await db.insert(users).values({
                    id: crypto.randomUUID(),
                    tenantId,
                    email: adminEmail,
                    passwordHash: adminPasswordHash,
                    role: 'owner',
                    createdAt: now,
                });

                // Default Template
                await db.insert(templates).values({
                    id: crypto.randomUUID(),
                    tenantId,
                    name: 'Standard Home Inspection',
                    version: 1,
                    schema: JSON.stringify({ title: 'Standard Home Inspection', sections: [] }),
                    createdAt: now,
                });
            } else {
                await db.update(users).set({ passwordHash: adminPasswordHash }).where(eq(users.id, existingUser.id));
            }
        }

        if (this.kv) await this.kv.delete(`tenant:${subdomain}`);
    }

    async handleStripeConnect(subdomain: string, accountId: string): Promise<void> {
        const db = this.getDrizzle();
        await db.update(tenants).set({ stripeConnectAccountId: accountId }).where(eq(tenants.subdomain, subdomain));
    }
}
