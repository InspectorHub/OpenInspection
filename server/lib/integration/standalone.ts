import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { tenants, users, templates, tenantConfigs } from '../db/schema';
import { deriveAuthorityBasis } from '../auth/authority-basis';
import { buildAcceptanceStatement } from '../../services/legal/account-acceptance';
import type { IntegrationProvider, TenantUpdateParams } from '../integration';
import { logger } from '../logger';
import { SQL_UUID_V4 } from './standalone-uuid';
import { seedDefaultAutomations } from './standalone-seed-automations';
import { SmsConsentService } from '../../services/sms-consent.service';
import { SMS_DISCLOSURE_V1 } from '../../services/automation/shared';

// Default Comment Library entries seeded into every new tenant. The same set
// is also backfilled into existing tenants by the default-comments seed
// migration. Each row is idempotent on (tenant_id, text) — seeded only when missing.
async function seedDefaultComments(db: D1Database, tenantId: string): Promise<void> {
    try {
        // One guarded INSERT per row, NOT one compound SELECT.
        //
        // This used to be eight `UNION ALL` arms in a derived table, and on real
        // D1 it failed every time with `too many terms in compound SELECT` —
        // D1's `SQLITE_MAX_COMPOUND_SELECT` sits far below the stock 500. The
        // failure was swallowed into a WARN, so every standalone workspace has
        // been created with ZERO default comments and the only trace was a log
        // line nobody reads. Found 2026-08-11 by watching an e2e run's output.
        //
        // The same ceiling bit the marketplace seeder earlier and was fixed the
        // same way there. Multi-row `VALUES` would hit it too; separate
        // statements in one batch do not.
        //
        // `created_at` is `mode: 'timestamp'` (seconds since epoch) in the
        // Drizzle schema; unixepoch('now') matches that contract directly. The
        // NOT EXISTS guard keeps each row safe to re-run.
        const rows: Array<[text: string, category: string]> = [
            ['GFCI protection is missing in kitchen/bathroom/exterior receptacles; recommend installation per current code.', 'Electrical'],
            ['Receptacle is wired with reverse polarity; recommend correction by qualified electrician.', 'Electrical'],
            ['Active leak observed at supply line/drain; recommend prompt repair by qualified plumber.', 'Plumbing'],
            ['Water heater TPR valve discharge pipe is missing/improperly terminated; recommend correction.', 'Plumbing'],
            ['Roof shingles show granule loss; recommend a qualified roofer evaluate remaining service life.', 'Roof'],
            ['Garage door auto-reverse safety did not function on test; recommend service by qualified technician.', 'Garage'],
            ['Smoke detector missing/non-functional in required location; recommend installation.', 'Electrical'],
            ['Carbon monoxide detector missing; recommend installation per current code.', 'Electrical'],
        ];
        const stmt = db.prepare(`
            INSERT INTO comments (id, tenant_id, text, category, created_at)
            SELECT ${SQL_UUID_V4}, ?, ?, ?, unixepoch('now')
            WHERE NOT EXISTS (SELECT 1 FROM comments c WHERE c.tenant_id = ? AND c.text = ?)
        `);
        await db.batch(rows.map(([text, category]) =>
            stmt.bind(tenantId, text, category, tenantId, text)));
    } catch (err) {
        // non-fatal: tenant creation must not fail because of seed data,
        // but the silent swallow used to hide real schema/permissions
        // problems — emit a warning so future failures are visible.
        logger.warn('seedDefaultComments.failed', {
            tenantId,
            error: err instanceof Error ? err.message : String(err),
        });
    }
}

// Default automation rules seeded for every new tenant — moved to
// `standalone-seed-automations.ts` (kept this file under the file-size gate's
// cap once it grew a message_templates seeding step alongside the automations
// INSERT). See that file for the seed data and the SP2 template-cutover
// rationale.

// Track L (D7) — seed the default TCPA SMS disclosure (version 1) once.
//
// THREE things used to be wrong here, and all three came from this path writing
// the row itself instead of asking the service that owns the table:
//
//  1. The disclosure text was a STRING LITERAL duplicated from
//     `SMS_DISCLOSURE_V1`. Two copies of the exact words a consumer consents to,
//     drifting independently, is the shape of a consent record pointing at text
//     that no longer says what it said.
//  2. It wrote no `content_hash`, so every self-hosted install started life with
//     an unhashed version — and a NULL hash never matches, so republishing the
//     identical text would mint a second version rather than being a no-op.
//  3. Its `NOT EXISTS` guard and the publish path's de-duplication answer
//     DIFFERENT questions — "does any version exist" versus "is this the same
//     text as the current one" — so having only the first one here meant the
//     platform default could be appended on top of a workspace's own wording.
//
// It now delegates, keeping the existence guard (which the service does not
// have) and inheriting the hashing and de-duplication (which this path did not).
async function seedSmsDisclosureV1(db: D1Database): Promise<void> {
    try {
        const existing = await db.prepare(
            'SELECT 1 FROM sms_disclosure_versions LIMIT 1',
        ).first();
        if (existing) return;
        await new SmsConsentService(db).publishDisclosure(SMS_DISCLOSURE_V1);
    } catch (err) {
        // non-fatal: setup wizard must not fail because of seed data
        logger.warn('seedSmsDisclosureV1.failed', {
            error: err instanceof Error ? err.message : String(err),
        });
    }
}

// Default pre-inspection agreement seeded for every new tenant. Plain-text
// content (no HTML) so the agreement viewer can render it consistently across
// sign UI, signed-copy email, and PDF. Idempotent on (tenant_id, name).
async function seedDefaultAgreement(db: D1Database, tenantId: string): Promise<void> {
    try {
        const content = [
            'PRE-INSPECTION AGREEMENT',
            '',
            '1. SCOPE OF INSPECTION',
            'This is a visual inspection of the readily accessible and visible portions of the property. The inspection is non-invasive: no destructive testing, no removal of finishes, panels, or insulation, and no dismantling of equipment. Areas concealed by stored items, vegetation, snow, finished surfaces, or otherwise inaccessible are excluded. Items not specifically called out in the report are outside the scope of this inspection.',
            '',
            '2. STANDARDS AND LIMITATIONS',
            'The inspection is performed in general accordance with widely accepted home inspection standards of practice. It is intended to identify material defects in the systems and components inspected on the date of the inspection only. The inspection is not a code, environmental, geological, structural-engineering, mold, lead-paint, asbestos, radon, pest, or hazardous-substance evaluation. We do not operate systems that are shut off, winterized, or appear unsafe to operate. We do not move furniture, appliances, or stored items.',
            '',
            '3. NON-WARRANTY',
            'The report is an opinion based on a limited visual observation. It is NOT a warranty, guarantee, insurance policy, or substitute for any disclosure required by law from the seller or any other party. Latent or concealed defects, conditions that change after the inspection, and conditions outside the inspector\'s scope are excluded. The client is encouraged to engage qualified specialists for any item the report recommends further evaluation of.',
            '',
            '4. CLIENT ACKNOWLEDGEMENT',
            'By signing below the client acknowledges that they have read this agreement, understand the scope and limitations of the inspection, and accept the inspector\'s findings as an opinion subject to the conditions stated above. The client agrees that any dispute arising from the inspection or report will be limited to the fee paid for the inspection.',
            '',
            '5. VALIDITY',
            'This agreement is valid for thirty (30) days from the date of signature and applies to the single inspection scheduled at the address identified in the booking. A new agreement is required for each subsequent inspection.',
            '',
            'Signed electronically by the client at the time and IP address recorded in the audit trail attached to this document.',
        ].join('\n');

        await db.prepare(`
            INSERT INTO agreements (id, tenant_id, name, content, version, created_at)
            SELECT ${SQL_UUID_V4}, ?, ?, ?, 1, unixepoch('now')
            WHERE NOT EXISTS (
                SELECT 1 FROM agreements WHERE tenant_id = ? AND name = ?
            )
        `).bind(tenantId, 'Pre-Inspection Agreement', content, tenantId, 'Pre-Inspection Agreement').run();
    } catch (err) {
        // non-fatal: setup wizard must not fail because of seed data
        logger.warn('seedDefaultAgreement failed', { tenantId, error: (err as Error).message });
    }
}

// Default services library seeded for every new tenant. These are the priced
// inspection products that customers pick from on /book; without them the
// public booking page has no items to add to cart. Idempotent on
// (tenant_id, name).
//
// The column list was `price` and `active`; the actual columns are `price_cents`
// and `is_active`, so every run of this threw and was swallowed by the catch
// below — a standalone tenant has never had a seeded catalogue, and the warning
// said so in a log nobody reads. Found because the E2E run surfaced it while
// failing for an unrelated reason.
async function seedDefaultServices(db: D1Database, tenantId: string): Promise<void> {
    try {
        await db.prepare(`
            INSERT INTO services (
                id, tenant_id, name, description, price_cents, duration_minutes,
                template_id, agreement_id, is_active, sort_order, created_at
            )
            SELECT
                ${SQL_UUID_V4}, ?, x.name, x.description, x.price, x.duration_minutes,
                NULL, NULL, 1, x.sort_order, unixepoch('now')
            FROM (
                SELECT 'Standard Home Inspection'    AS name, 'Full visual inspection of the home — structure, roof, electrical, plumbing, HVAC, interior, exterior.' AS description, 40000 AS price, 180 AS duration_minutes, 0 AS sort_order UNION ALL
                SELECT 'Pre-Listing Inspection',          'Inspection performed for the seller before listing the home, so issues can be addressed in advance.',     35000,         150,                  1 UNION ALL
                SELECT 'Termite Inspection Add-on',       'Wood-destroying organism inspection. Add-on to a Standard or Pre-Listing inspection.',                    15000,         30,                   2
            ) AS x
            WHERE NOT EXISTS (
                SELECT 1 FROM services s WHERE s.tenant_id = ? AND s.name = x.name
            )
        `).bind(tenantId, tenantId).run();
    } catch (err) {
        // non-fatal: setup wizard must not fail because of seed data
        logger.warn('seedDefaultServices.failed', {
            tenantId,
            error: err instanceof Error ? err.message : String(err),
        });
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
        const { id, slug, status, tier, name, deploymentMode, maxUsers, adminEmail, adminPasswordHash, adminName, acceptance } = params;

        let tenantId = id || crypto.randomUUID();
        // Prefer the stable tenant id (slug can change — e.g. the 2026-06-03
        // subdomain→slug migration); fall back to slug only when no id is given.
        const existingTenant = (id
            ? await db.select().from(tenants).where(eq(tenants.id, id)).get()
            : undefined)
            ?? await db.select().from(tenants).where(eq(tenants.slug, slug)).get();

        if (!existingTenant) {
            await db.insert(tenants).values({
                id: tenantId,
                slug,
                tier: tier || 'free',
                status: (adminEmail ? 'active' : status) || 'pending',
                deploymentMode: deploymentMode || 'silo',
                ...(maxUsers != null ? { maxUsers } : {}),
                createdAt: new Date(),
            });
        } else {
            tenantId = existingTenant.id;
            const update: Record<string, string | number | Date> = {
                // Heal a stale slug when the row was matched by id.
                slug,
                status: (adminEmail ? 'active' : status) || 'pending'
            };
            if (tier) update.tier = tier;
            if (deploymentMode) update.deploymentMode = deploymentMode;
            if (maxUsers != null) update.maxUsers = maxUsers;
            // `update.name = name` was here. tsc named five of the six sites
            // touching that column and missed this one: `update` is a
            // `Record<string, …>`, so a dynamic key type-checks against anything.

            await db.update(tenants).set(update).where(eq(tenants.id, tenantId));
        }

        // Initialize companyName — initialize-only, so a name the tenant chose
        // in settings wins. No `|| slug`: it renders the same (tenantDisplayName
        // already COALESCEs) but fills the slot, so a later name never lands.
        const initialName = name;
        if (initialName) {
            const cfg = await db.select().from(tenantConfigs).where(eq(tenantConfigs.tenantId, tenantId)).get();
            if (!cfg) {
                await db.insert(tenantConfigs).values({
                    tenantId,
                    companyName: initialName,
                    updatedAt: new Date(),
                });
            } else if (!cfg.companyName) {
                await db.update(tenantConfigs)
                    .set({ companyName: initialName, updatedAt: new Date() })
                    .where(eq(tenantConfigs.tenantId, tenantId));
            }
            // companyName already set → leave it (initialize-only, never overwrite)
        }

        // Handle Admin User creation/sync
        if (adminEmail && adminPasswordHash) {
            const existingUser = await db.select().from(users).where(eq(users.email, adminEmail)).get();
            if (!existingUser) {
                const now = new Date();
                const userId = crypto.randomUUID();
                // The basis comes from the DOOR, never from a lookup: this is
                // the `/setup` wizard, where the person is bringing the
                // workspace into existence, so `owner`. Any basis the caller
                // declared is ignored rather than trusted — the standalone
                // provider IS the setup door, and accepting a declared basis
                // here would let a caller assert an authority nobody checked.
                const acceptanceStatements = acceptance
                    ? buildAcceptanceStatement(db, {
                        tenantId,
                        userId,
                        ...(acceptance.actorIdentityRef ? { actorIdentityRef: acceptance.actorIdentityRef } : {}),
                        authorityBasis: deriveAuthorityBasis({ path: 'setup' }),
                        documents: acceptance.documents,
                    })
                    : [];
                // ONE WRITE, even when the acceptance list is empty — the batch
                // is the shape, not a branch, so the atomic path is the path in
                // use rather than one only some callers reach.
                //
                // ⚠️ ABSENCE IS NOT A REFUSAL HERE, AND THAT IS A KNOWN GAP, not
                // a decision that self-hosters owe nothing. Refusing would make
                // `/setup` impossible on this build, because THERE IS NOTHING TO
                // ACCEPT: `deployment_legal_versions` holds one document kind
                // (`agent_terms`, the operator's contract with global agents),
                // and the tenant's own `tenant_legal_versions` cannot exist yet
                // — the tenant is being created in this same request, and the
                // first version is written when an admin later saves their
                // Privacy/Terms text in settings. A refusal with no document
                // behind it would be a gate that can only ever say no.
                //
                // What closes it is a document, not a stricter check: the
                // deployment publishing terms the first operator is shown at
                // `/setup` (which needs `deployment_legal_versions.doc` widened
                // and a field on `SetupSchema`). Until then this path creates an
                // owner account with no acceptance, and saying so plainly beats
                // a `?? []` that reads as coverage.
                const statements = [
                    db.insert(users).values({
                        id: userId,
                        tenantId,
                        email: adminEmail,
                        passwordHash: adminPasswordHash,
                        role: 'owner',
                        // adminName is required by the setup form so this is never
                        // empty for first-time admin users.
                        ...(adminName ? { name: adminName } : {}),
                        createdAt: now,
                    }),
                    ...acceptanceStatements,
                ];
                await db.batch(statements as unknown as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);

                // Default Template — empty starter. Renamed from "Standard
                // Home Inspection" (R7-23) because it collided semantically
                // with the Marketplace template "Standard Residential
                // Inspection" — inspector saw two near-identical names and
                // couldn't tell which was the empty starter vs. the curated
                // 40-item residential template. The "(Blank)" suffix makes
                // it obvious this is the user's own scratch template.
                // DELIBERATELY carries no `templateCreate` capability (#307).
                // First-run setup runs before any user exists, so there is no
                // acting user and no capability set to consult.
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

                // ORDERING: seed the system role profiles (client/buyer_agent/
                // listing_agent) BEFORE the default automations below. This
                // handleTenantUpdate path runs BEFORE seedStarterContent (→
                // seedRoleProfiles) in the /setup flow (server/api/auth.ts), so
                // without this the automation seeder's recipientRoleKey →
                // contact_role_profiles.id subqueries would find no rows yet.
                // Idempotent — seedStarterContent calls seedRoleProfiles again
                // later harmlessly.
                const { seedRoleProfiles } = await import('../../services/seed/seed-role-profiles');
                await seedRoleProfiles(this.getDrizzle(), tenantId, now);

                // Default automation rules so lifecycle emails (booking,
                // report-ready, agreement-sent, invoice, payment) actually
                // fire on a fresh tenant. UC-A-3 / UC-C-2 / UC-C-3 gap.
                await seedDefaultAutomations(this.db, tenantId);

                // Track L (D7) — default TCPA SMS opt-in disclosure (version 1) so
                // the consent ledger has a version to stamp on the first opt-in.
                await seedSmsDisclosureV1(this.db);

                // Default pre-inspection agreement template so the e-sign flow
                // (UC-C-2) has a document to send.
                await seedDefaultAgreement(this.db, tenantId);

                // Default priced services so the public booking page (UC-C-3
                // multi-service booking) has items to render.
                await seedDefaultServices(this.db, tenantId);
            } else {
                await db.update(users).set({ passwordHash: adminPasswordHash }).where(eq(users.id, existingUser.id));
            }
        }

        if (this.kv) await this.kv.delete(`tenant:${slug}`);
    }

}
