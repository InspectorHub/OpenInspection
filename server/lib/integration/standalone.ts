import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { tenants, users, templates, tenantConfigs } from '../db/schema';
import { IntegrationProvider, TenantUpdateParams } from '../integration';
import { logger } from '../logger';

/**
 * SQLite expression that generates a canonically-formatted UUID v4
 * (8-4-4-4-12 with hyphens, version='4', variant='a'). Earlier seed code
 * used `lower(hex(randomblob(16)))` which produced a 32-char flat hex
 * string — Zod UUID validators on send-agreement / list-services /
 * automation API endpoints reject those, so seeded rows became
 * unreferenceable.
 */
const SQL_UUID_V4 = `lower(
    substr(hex(randomblob(4)), 1, 8) || '-' ||
    substr(hex(randomblob(2)), 1, 4) || '-' ||
    '4' || substr(hex(randomblob(2)), 2, 3) || '-' ||
    'a' || substr(hex(randomblob(2)), 2, 3) || '-' ||
    substr(hex(randomblob(6)), 1, 12)
)`;

// Default Comment Library entries seeded into every new tenant. The same set
// is also backfilled into existing tenants by the default-comments seed
// migration. Each row is idempotent on (tenant_id, text) — seeded only when missing.
async function seedDefaultComments(db: D1Database, tenantId: string): Promise<void> {
    try {
        // Idempotent NOT EXISTS clause keeps this safe to re-run.
        // `created_at` is `mode: 'timestamp'` (seconds since epoch) in the
        // Drizzle schema; unixepoch('now') matches that contract directly.
        await db.prepare(`
            INSERT INTO comments (id, tenant_id, text, category, created_at)
            SELECT ${SQL_UUID_V4}, ?, x.text, x.category, unixepoch('now')
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

// Default automation rules seeded for every new tenant. Without these, none of
// the lifecycle emails (booking confirm, report ready, agreement nag, invoice,
// payment receipt) actually fire. Schema constrains `trigger` to a fixed enum
// (see the `automationRules` table in schema) and `recipient` to a single value
// per row, so multi-recipient intents fan out into one row per recipient.
//
// Idempotent: NOT EXISTS guard on (tenant_id, trigger, recipient, name).
// Implemented as a per-row JS loop because D1 caps compound SELECT terms
// (~10) so the prior single-statement INSERT … SELECT … UNION ALL fan-out
// raised SQLITE_ERROR "too many terms in compound SELECT" at run time.
async function seedDefaultAutomations(db: D1Database, tenantId: string): Promise<void> {
    // Tuple shape: [trigger, recipient, name, subject, body, active, smsBody]. The
    // active flag is 1 (enabled) for all lifecycle rules; only the Track J (#122)
    // "Review request" row is 0 (seeded inactive — fail-closed until review_url set).
    // smsBody (Track L) is the plain-text SMS template for the 3 client touchpoints
    // (booking / reminder / report-ready); null elsewhere. channels stays email-only
    // ('["email"]') for every seed — SMS is enabled per-rule by the inspector later.
    // NOTE: keep these rows semantically in sync with AUTOMATION_SEEDS in
    // server/data/automation-seeds.ts (the parallel seed path used by ensureSeeds).
    const rows: Array<[string, string, string, string, string, number, string | null]> = [
        ['report.published', 'client', 'Report Ready (Client)', 'Your inspection report is ready — {{property_address}}', '<p>Hi {{client_name}},</p><p>Your inspection report for <strong>{{property_address}}</strong> is ready to view.</p><p><a href="{{report_url}}">View Report</a></p><p>— {{company_name}}</p>', 1, '{{company_name}}: your inspection report for {{property_address}} is ready: {{report_url}} Reply STOP to opt out; questions? call {{company_phone}}'],
        ['report.published', 'buying_agent', "Report Ready (Buyer's Agent)", 'Your inspection report is ready — {{property_address}}', '<p>The inspection report for <strong>{{property_address}}</strong> is ready.</p><p><a href="{{report_url}}">View Report</a></p><p>— {{company_name}}</p>', 1, null],
        ['inspection.confirmed', 'client', '24-Hour Reminder', 'Reminder: Inspection tomorrow — {{property_address}}', '<p>Hi {{client_name}},</p><p>Just a reminder that your inspection at <strong>{{property_address}}</strong> is scheduled for <strong>{{scheduled_date}}</strong>. Your inspector will arrive during the scheduled window.</p><p>— {{company_name}}</p>', 1, '{{company_name}}: reminder — your inspection at {{property_address}} is {{scheduled_date}}. Reply STOP to opt out; questions? call {{company_phone}}'],
        ['inspection.cancelled', 'client', 'Cancellation Notice (Client)', 'Inspection cancelled — {{property_address}}', '<p>Hi {{client_name}},</p><p>Your inspection at <strong>{{property_address}}</strong> has been cancelled. Please contact us to reschedule.</p><p>— {{company_name}}</p>', 1, null],
        ['inspection.cancelled', 'buying_agent', "Cancellation Notice (Buyer's Agent)", 'Inspection cancelled — {{property_address}}', '<p>The inspection at <strong>{{property_address}}</strong> has been cancelled. The client may need to reschedule.</p><p>— {{company_name}}</p>', 1, null],
        ['inspection.created', 'client', 'Booking Confirmation', 'Your inspection is scheduled — {{property_address}}', '<p>Hi {{client_name}},</p><p>Your inspection at <strong>{{property_address}}</strong> has been scheduled for <strong>{{scheduled_date}}</strong>.</p><p>Your inspector: {{inspector_name}}</p><p>— {{company_name}}</p>', 1, '{{company_name}}: your inspection at {{property_address}} is set for {{scheduled_date}}. Reply STOP to opt out; questions? call {{company_phone}}'],
        ['inspection.created', 'client', 'Send Agreement to Client', 'Please sign your inspection agreement — {{property_address}}', '<p>Hi {{client_name}},</p><p>Please review and sign the inspection agreement for <strong>{{property_address}}</strong> scheduled for {{scheduled_date}}.</p><p><a href="{{agreement_sign_url}}">Review &amp; Sign Agreement</a></p><p>— {{company_name}}</p>', 1, null],
        ['agreement.signed', 'client', 'Agreement Signed Confirmation', 'Confirmation: agreement signed — {{property_address}}', '<p>Hi {{client_name}},</p><p>Thank you for signing the inspection agreement for <strong>{{property_address}}</strong>. We will see you on {{scheduled_date}}.</p><p>— {{company_name}}</p>', 1, null],
        ['invoice.created', 'client', 'Invoice / Payment Request', 'Invoice for your inspection — {{property_address}}', '<p>Hi {{client_name}},</p><p>An invoice has been created for your inspection at <strong>{{property_address}}</strong>.</p><p><a href="{{invoice_url}}">View &amp; Pay Invoice</a></p><p>— {{company_name}}</p>', 1, null],
        ['payment.received', 'inspector', 'Payment Received (Inspector)', 'Payment received — {{property_address}}', '<p>Payment has been received for the inspection at <strong>{{property_address}}</strong> (client: {{client_name}}).</p><p>— {{company_name}}</p>', 1, null],
        ['payment.received', 'client', 'Payment Received (Client Receipt)', 'Receipt: payment received — {{property_address}}', '<p>Hi {{client_name}},</p><p>Thank you — your payment for the inspection at <strong>{{property_address}}</strong> has been received.</p><p>— {{company_name}}</p>', 1, null],
        ['report.published', 'client', 'Post-inspection follow-up', 'Following up on your inspection — {{property_address}}', '<p>Hi {{client_name}},</p><p>We hope your inspection report for <strong>{{property_address}}</strong> was helpful. If anything raised a question, just reply — we are happy to help.</p><p>— {{company_name}}</p>', 1, null],
        ['report.published', 'client', 'Review request', 'How did we do? — {{property_address}}', '<p>Hi {{client_name}},</p><p>Thanks for choosing us for your inspection at <strong>{{property_address}}</strong>. A short review helps other homebuyers find us:</p><p><a href="{{review_url}}">Leave a review</a></p><p>— {{company_name}}</p>', 0, null], // active=0: inactive until review_url configured
    ];
    const stmt = `
        INSERT INTO automations (id, tenant_id, trigger, recipient, name, delay_minutes, subject_template, body_template, active, channels, sms_body, is_default, created_at)
        SELECT ${SQL_UUID_V4}, ?, ?, ?, ?, 0, ?, ?, ?, '["email"]', ?, 1, unixepoch('now')
        WHERE NOT EXISTS (
            SELECT 1 FROM automations WHERE tenant_id = ? AND trigger = ? AND recipient = ? AND name = ?
        )
    `;
    for (const [trigger, recipient, name, subject, body, active, smsBody] of rows) {
        try {
            await db.prepare(stmt)
                .bind(tenantId, trigger, recipient, name, subject, body, active, smsBody, tenantId, trigger, recipient, name)
                .run();
        } catch (err) {
            logger.warn('seedDefaultAutomations.row.failed', {
                tenantId, trigger, name,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }
}

// Track L (D7) — seed the default TCPA SMS disclosure (version 1) once. Idempotent:
// inserts only when no version exists yet (max-version guard via NOT EXISTS).
async function seedSmsDisclosureV1(db: D1Database): Promise<void> {
    try {
        await db.prepare(`
            INSERT INTO sms_disclosure_versions (version, text, published_at)
            SELECT 1, ?, unixepoch('now') * 1000
            WHERE NOT EXISTS (SELECT 1 FROM sms_disclosure_versions)
        `).bind(
            'By providing your phone number and opting in, you agree to receive appointment and report text messages from {{company_name}}. Message frequency varies by your inspection activity. Message and data rates may apply. Reply STOP to opt out, HELP for help.',
        ).run();
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
async function seedDefaultServices(db: D1Database, tenantId: string): Promise<void> {
    try {
        await db.prepare(`
            INSERT INTO services (
                id, tenant_id, name, description, price, duration_minutes,
                template_id, agreement_id, active, sort_order, created_at
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
        const { id, slug, status, tier, name, deploymentMode, maxUsers, adminEmail, adminPasswordHash, adminName } = params;

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
                name: name || slug,
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
            if (name) update.name = name;
            if (maxUsers != null) update.maxUsers = maxUsers;

            await db.update(tenants).set(update).where(eq(tenants.id, tenantId));
        }

        // IA-27: initialize tenant_configs.companyName from the company name so the
        // brand never boots as the platform default. Initialize-only — never
        // overwrites a name the tenant has already chosen.
        if (name) {
            const cfg = await db.select().from(tenantConfigs).where(eq(tenantConfigs.tenantId, tenantId)).get();
            if (!cfg) {
                await db.insert(tenantConfigs).values({
                    tenantId,
                    companyName: name,
                    updatedAt: new Date(),
                });
            } else if (!cfg.companyName) {
                await db.update(tenantConfigs)
                    .set({ companyName: name, updatedAt: new Date() })
                    .where(eq(tenantConfigs.tenantId, tenantId));
            }
            // companyName already set → leave it (initialize-only, never overwrite)
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
                    // adminName is required by the setup form so this is never
                    // empty for first-time admin users.
                    ...(adminName ? { name: adminName } : {}),
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
