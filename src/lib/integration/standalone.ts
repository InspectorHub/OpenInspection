import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { tenants, users, templates } from '../db/schema';
import { IntegrationProvider, TenantUpdateParams } from '../integration';

// Default Comment Library entries seeded into every new tenant. The same set
// is also seeded into existing tenants by migration 0022_seed_default_comments.
// Each row is idempotent on (tenant_id, text) — seeded only when missing.
async function seedDefaultComments(db: D1Database, tenantId: string): Promise<void> {
    try {
        await db.prepare(`
            INSERT INTO comments (id, tenant_id, text, category, created_at)
            SELECT lower(hex(randomblob(16))), ?, x.text, x.category, unixepoch('now')
            FROM (
                SELECT 'GFCI protection is missing in kitchen/bathroom/exterior receptacles; recommend installation per current code.' AS text, 'Electrical' AS category UNION ALL
                SELECT 'Receptacle is wired with reverse polarity; recommend correction by qualified electrician.', 'Electrical' UNION ALL
                SELECT 'Active leak observed at supply line/drain; recommend prompt repair by qualified plumber.', 'Plumbing' UNION ALL
                SELECT 'Water heater TPR valve discharge pipe is missing/improperly terminated; recommend correction.', 'Plumbing' UNION ALL
                SELECT 'Roof shingles show granule loss; recommend a qualified roofer evaluate remaining service life.', 'Roof' UNION ALL
                SELECT 'Garage door auto-reverse safety did not function on test; recommend service by qualified technician.', 'Garage' UNION ALL
                SELECT 'Smoke detector missing/non-functional in required location; recommend installation.', 'Electrical' UNION ALL
                SELECT 'Carbon monoxide detector missing; recommend installation per current code.', 'Electrical'
            ) AS x
            WHERE NOT EXISTS (SELECT 1 FROM comments c WHERE c.tenant_id = ? AND c.text = x.text)
        `).bind(tenantId, tenantId).run();
    } catch {
        // non-fatal: tenant creation must not fail because of seed data
    }
}

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
        const { id, subdomain, status, tier, name, deploymentMode, maxUsers, adminEmail, adminPasswordHash } = params;

        let tenantId = id || crypto.randomUUID();
        const existingTenant = await db.select().from(tenants).where(eq(tenants.subdomain, subdomain)).get();

        if (!existingTenant) {
            await db.insert(tenants).values({
                id: tenantId,
                name: name || subdomain,
                subdomain,
                tier: tier || 'free',
                status: (adminEmail ? 'active' : status) || 'pending',
                deploymentMode: deploymentMode || 'silo',
                ...(maxUsers != null ? { maxUsers } : {}),
                createdAt: new Date(),
            });
        } else {
            tenantId = existingTenant.id;
            const update: Record<string, string | number | Date> = {
                status: (adminEmail ? 'active' : status) || 'pending'
            };
            if (tier) update.tier = tier;
            if (deploymentMode) update.deploymentMode = deploymentMode;
            if (name) update.name = name;
            if (maxUsers != null) update.maxUsers = maxUsers;

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

                // Default Template — empty starter. Renamed from "Standard
                // Home Inspection" (R7-23) because it collided semantically
                // with the Marketplace template "Standard Residential
                // Inspection" — inspector saw two near-identical names and
                // couldn't tell which was the empty starter vs. the curated
                // 40-item residential template. The "(Blank)" suffix makes
                // it obvious this is the user's own scratch template.
                await db.insert(templates).values({
                    id: crypto.randomUUID(),
                    tenantId,
                    name: 'My Inspection Template (Blank)',
                    version: 1,
                    schema: JSON.stringify({ title: 'My Inspection Template (Blank)', sections: [] }),
                    createdAt: now,
                });

                // Default Comment Library — gives new inspectors a starting set
                // so they aren't typing every defect description from scratch.
                await seedDefaultComments(this.db, tenantId);
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
