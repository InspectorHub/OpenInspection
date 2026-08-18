import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { tenants, tenantConfigs, tenantSlugHistory } from '../lib/db/schema';
import { SLUG_RETIREMENT_MS } from '../lib/db/schema/tenant/slug-history';
import type { IntegrationProvider, TenantUpdateParams } from '../lib/integration';
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
        const { id, slug, status, tier, name, maxUsers, adminEmail, adminPasswordHash, acceptance } = params;

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
            // Same condition the KV invalidation below already uses, so this
            // costs no extra comparison and needs no new command type. Recorded
            // BEFORE the update for the same reason portal records before its
            // own: once the row moves, the old value survives nowhere else.
            if (existingTenant.slug !== slug) {
                const now = new Date();
                const retiredUntil = new Date(now.getTime() + SLUG_RETIREMENT_MS);
                await db.insert(tenantSlugHistory).values({
                    oldSlug: existingTenant.slug, tenantId: existingTenant.id,
                    changedAt: now, retiredUntil,
                }).onConflictDoUpdate({
                    target: tenantSlugHistory.oldSlug,
                    set: { tenantId: existingTenant.id, changedAt: now, retiredUntil },
                });
            }
            await db.update(tenants)
                .set({
                    // Correct the slug too — heals a stale (e.g. legacy UUID) slug
                    // when the row was matched by id.
                    slug,
                    status: (status as 'active' | 'suspended' | 'trial') || existingTenant.status,
                    tier: (tier as 'free' | 'pro' | 'enterprise') || existingTenant.tier,
                    ...(maxUsers != null ? { maxUsers } : {}),
                })
                .where(eq(tenants.id, existingTenant.id));
            // Drop the stale-slug cache entry too (the row may have just changed slug).
            if (this.kv && existingTenant.slug !== slug) await this.kv.delete(`tenant:${existingTenant.slug}`);
        }

        // Initialize tenant_configs.companyName so the brand never boots as the
        // platform default. Initialize-only: if the tenant has already chosen a
        // name in its own settings, that choice wins and is left untouched.
        //
        // This is now the ONLY place a name from portal can land. `tenants.name`
        // used to take it as well, and display fell back to that column — so a
        // rename arriving here still showed up for a tenant that had never set
        // its own name. With the column gone the fallback is gone too, and the
        // rule is simply: settings owns the name once settings has one.
        //
        // A rename does not travel this path at all — it has its own command
        // (`cmd.tenant.rename` → applyTenantRename), which writes
        // unconditionally precisely because THIS write is initialize-only. Right
        // for a provisioning sync, silently wrong for a rename; hence two
        // commands.
        //
        // NO `|| slug` fallback, and the reason is that the slug fallback
        // already exists — lazily, in `tenantDisplayName`
        // (COALESCE(NULLIF(TRIM(company_name),''), slug)). Doing it EAGERLY here
        // renders identically and costs something the lazy one does not: it
        // fills the initialize-only slot. `name` is optional on
        // `cmd.tenant.update`, which also carries status/tier/seat changes, so a
        // nameless update is ordinary traffic — and one arriving before the
        // named provisioning would write the slug, take the slot, and leave the
        // real company name permanently unable to land.
        //
        // Every other reader of `company_name` already handles null (admin
        // settings, branding and the booking agreement each carry their own
        // `|| APP_NAME` / `?? null` default), so writing nothing costs nothing.
        const initialName = name;
        if (initialName) {
            const finalTenantId = id || existingTenant?.id;
            if (finalTenantId) {
                const cfg = await db.select().from(tenantConfigs).where(eq(tenantConfigs.tenantId, finalTenantId)).get();
                if (!cfg) {
                    await db.insert(tenantConfigs).values({
                        tenantId: finalTenantId,
                        companyName: initialName,
                        updatedAt: new Date(),
                    });
                } else if (!cfg.companyName) {
                    await db.update(tenantConfigs)
                        .set({ companyName: initialName, updatedAt: new Date() })
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
            // The acceptance travels with the credential on this path too. The
            // RPC entry point (`PATCH /api/integration/tenants/:slug`) is the
            // fallback the onboarding workflow uses when the command queue is
            // unavailable, so leaving it out here would mean the invariant held
            // on the queue path and not on the path taken when the queue is
            // broken — the worse of the two moments to lose it.
            await applyAdminCredential(this.db, {
                tenantId: finalTenantId,
                adminEmail,
                adminPasswordHash,
                ...(acceptance !== undefined && { acceptance }),
            });
        }

        // Clear cache if KV exists
        if (this.kv) {
            // Standardized key matched with tenant-router.ts
            await this.kv.delete(`tenant:${slug}`);
        }
    }

}
