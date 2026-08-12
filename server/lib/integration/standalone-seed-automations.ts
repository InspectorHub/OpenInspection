import { nanoid } from 'nanoid';
import { logger } from '../logger';
import { extractVars } from '../../services/message-template-backfill';
import { SQL_UUID_V4 } from './standalone-uuid';

// Default automation rules seeded for every new tenant. Without these, none of
// the lifecycle emails (booking confirm, report ready, agreement nag, invoice,
// payment receipt) actually fire. Schema constrains `trigger` to a fixed enum
// (see the `automations` table in schema) and each row targets a single
// recipient discriminator (recipient_kind + recipient_role_profile_id), so
// multi-recipient intents fan out into one row per recipient.
//
// Idempotent: every INSERT below (both message_templates writes and the
// automations write) carries its own `WHERE NOT EXISTS` guard against the
// same (tenant_id, trigger, recipient_kind, name) lookup, evaluated by the
// database at write time — so two concurrent callers can no longer both pass
// a check and double-seed the same rule. The three statements for one row are
// additionally run in a single db.batch() so a failure partway through (e.g.
// the automations insert) cannot leave that row's templates committed with
// nothing referencing them.
//
// Implemented as a per-row JS loop because D1 caps compound SELECT terms
// (~10) so a prior single-statement INSERT … SELECT … UNION ALL fan-out
// raised SQLITE_ERROR "too many terms in compound SELECT" at run time.
//
// PREREQUISITE: this runs from handleTenantUpdate (StandaloneProvider), which
// executes BEFORE seedStarterContent → seedRoleProfiles in the /setup flow
// (server/api/auth.ts). The caller seeds role profiles first so the
// recipientRoleKey → contact_role_profiles.id subquery has rows to find.
export async function seedDefaultAutomations(db: D1Database, tenantId: string): Promise<void> {
    // Tuple shape: [trigger, recipientRoleKey|null, name, subject, body, active, smsBody].
    // recipientRoleKey null means recipient_kind='inspector' for that row (no seed here
    // uses 'all'); a non-null key means recipient_kind='role' and the INSERT below
    // resolves it to the tenant's contact_role_profiles.id via a correlated subquery.
    // The active flag is 1 (enabled) for all lifecycle rules; only the Track J (#122)
    // "Review request" row is 0 (seeded inactive — fail-closed until review_url set).
    // smsBody (Track L) is the plain-text SMS template for the 3 client touchpoints
    // (booking / reminder / report-ready); null elsewhere. channels stays email-only
    // ('["email"]') for every seed — SMS is enabled per-rule by the inspector later.
    // NOTE: keep these rows semantically in sync with AUTOMATION_SEEDS in
    // server/data/automation-seeds.ts (the parallel seed path used by ensureSeeds).
    const rows: Array<[string, string | null, string, string, string, number, string | null]> = [
        ['report.published', 'client', 'Report Ready (Client)', 'Your inspection report is ready — {{property_address}}', '<p>Hi {{client_name}},</p><p>Your inspection report for <strong>{{property_address}}</strong> is ready to view.</p><p><a href="{{report_url}}">View Report</a></p><p>— {{company_name}}</p>', 1, '{{company_name}}: your inspection report for {{property_address}} is ready: {{report_url}} Reply STOP to opt out; questions? call {{company_phone}}'],
        ['report.published', 'buyer_agent', "Report Ready (Buyer's Agent)", 'Your inspection report is ready — {{property_address}}', '<p>The inspection report for <strong>{{property_address}}</strong> is ready.</p><p><a href="{{report_url}}">View Report</a></p><p>— {{company_name}}</p>', 1, null],
        ['report.published', 'listing_agent', 'Report Ready (Listing Agent)', 'Your inspection report is ready — {{property_address}}', '<p>The inspection report for <strong>{{property_address}}</strong> is ready.</p><p><a href="{{report_url}}">View Report</a></p><p>— {{company_name}}</p>', 0, null], // active=0: listing agent seeded inactive by default (Spec 2 §3.5)
        ['report.amended', 'client', 'Report Updated (Client)', 'Your inspection report was updated — {{property_address}}', '<p>Hi {{client_name}},</p><p>Your inspection report for <strong>{{property_address}}</strong> has been updated.</p><p>{{summary}}</p><p><a href="{{report_url}}">View the updated report</a></p><p>— {{company_name}}</p>', 1, '{{company_name}}: your inspection report for {{property_address}} was updated: {{report_url}} Reply STOP to opt out; questions? call {{company_phone}}'],
        ['report.amended', 'buyer_agent', "Report Updated (Buyer's Agent)", 'Inspection report updated — {{property_address}}', '<p>The inspection report for <strong>{{property_address}}</strong> has been updated.</p><p>{{summary}}</p><p><a href="{{report_url}}">View the updated report</a></p><p>— {{company_name}}</p>', 1, null],
        ['inspection.confirmed', 'client', '24-Hour Reminder', 'Reminder: Inspection tomorrow — {{property_address}}', '<p>Hi {{client_name}},</p><p>Just a reminder that your inspection at <strong>{{property_address}}</strong> is scheduled for <strong>{{scheduled_date}}</strong>. Your inspector will arrive during the scheduled window.</p><p>— {{company_name}}</p>', 1, '{{company_name}}: reminder — your inspection at {{property_address}} is {{scheduled_date}}. Reply STOP to opt out; questions? call {{company_phone}}'],
        ['inspection.cancelled', 'client', 'Cancellation Notice (Client)', 'Inspection cancelled — {{property_address}}', '<p>Hi {{client_name}},</p><p>Your inspection at <strong>{{property_address}}</strong> has been cancelled. Please contact us to reschedule.</p><p>— {{company_name}}</p>', 1, null],
        ['inspection.cancelled', 'buyer_agent', "Cancellation Notice (Buyer's Agent)", 'Inspection cancelled — {{property_address}}', '<p>The inspection at <strong>{{property_address}}</strong> has been cancelled. The client may need to reschedule.</p><p>— {{company_name}}</p>', 1, null],
        ['inspection.created', 'client', 'Booking Confirmation', 'Your inspection is scheduled — {{property_address}}', '<p>Hi {{client_name}},</p><p>Your inspection at <strong>{{property_address}}</strong> has been scheduled for <strong>{{scheduled_date}}</strong>.</p><p>Your inspector: {{inspector_name}}</p><p>— {{company_name}}</p>', 1, '{{company_name}}: your inspection at {{property_address}} is set for {{scheduled_date}}. Reply STOP to opt out; questions? call {{company_phone}}'],
        ['inspection.created', 'client', 'Send Agreement to Client', 'Please sign your inspection agreement — {{property_address}}', '<p>Hi {{client_name}},</p><p>Please review and sign the inspection agreement for <strong>{{property_address}}</strong> scheduled for {{scheduled_date}}.</p><p><a href="{{agreement_sign_url}}">Review &amp; Sign Agreement</a></p><p>— {{company_name}}</p>', 1, null],
        ['agreement.signed', 'client', 'Agreement Signed Confirmation', 'Confirmation: agreement signed — {{property_address}}', '<p>Hi {{client_name}},</p><p>Thank you for signing the inspection agreement for <strong>{{property_address}}</strong>. We will see you on {{scheduled_date}}.</p><p>— {{company_name}}</p>', 1, null],
        ['invoice.created', 'client', 'Invoice / Payment Request', 'Invoice for your inspection — {{property_address}}', '<p>Hi {{client_name}},</p><p>An invoice has been created for your inspection at <strong>{{property_address}}</strong>.</p><p><a href="{{invoice_url}}">View &amp; Pay Invoice</a></p><p>— {{company_name}}</p>', 1, null],
        ['payment.received', null, 'Payment Received (Inspector)', 'Payment received — {{property_address}}', '<p>Payment has been received for the inspection at <strong>{{property_address}}</strong> (client: {{client_name}}).</p><p>— {{company_name}}</p>', 1, null],
        ['payment.received', 'client', 'Payment Received (Client Receipt)', 'Receipt: payment received — {{property_address}}', '<p>Hi {{client_name}},</p><p>Thank you — your payment for the inspection at <strong>{{property_address}}</strong> has been received.</p><p>— {{company_name}}</p>', 1, null],
        // The lab result arriving. Names kept BYTE-IDENTICAL to the matching
        // AUTOMATION_SEEDS rows: ensureSeeds dedupes on (name, trigger), and
        // automation-classes.ts keys its notification class on the same pair —
        // a standalone-only name would re-seed the rule twice and leave both
        // copies unclassifiable.
        ['event.results_received', 'client', 'Event Results Received', 'Your {{event_type_name}} results are in — {{property_address}}', '<p>Hi {{client_name}},</p><p>The results for your {{event_type_name}} at <strong>{{property_address}}</strong> have arrived and are now in your {{event_type_name}} report.</p><p><a href="{{report_url}}">View the report</a></p><p>— {{company_name}}</p>', 1, '{{company_name}}: your {{event_type_name}} results for {{property_address}} are in: {{report_url}} Reply STOP to opt out; questions? call {{company_phone}}'],
        ['event.results_received', 'buyer_agent', "Event Results Received (Buyer's Agent)", '{{event_type_name}} results are in — {{property_address}}', '<p>Hello,</p><p>The results for the {{event_type_name}} at <strong>{{property_address}}</strong> have arrived and are now in the {{event_type_name}} report.</p><p><a href="{{report_url}}">View the report</a></p><p>— {{company_name}}</p>', 1, '{{company_name}}: the {{event_type_name}} results for {{property_address}} are in: {{report_url}} Reply STOP to opt out; questions? call {{company_phone}}'],
        ['report.published', 'client', 'Post-inspection follow-up', 'Following up on your inspection — {{property_address}}', '<p>Hi {{client_name}},</p><p>We hope your inspection report for <strong>{{property_address}}</strong> was helpful. If anything raised a question, just reply — we are happy to help.</p><p>— {{company_name}}</p>', 1, null],
        ['report.published', 'client', 'Review request', 'How did we do? — {{property_address}}', '<p>Hi {{client_name}},</p><p>Thanks for choosing us for your inspection at <strong>{{property_address}}</strong>. A short review helps other homebuyers find us:</p><p><a href="{{review_url}}">Leave a review</a></p><p>— {{company_name}}</p>', 0, null], // active=0: inactive until review_url configured
    ];
    // The correlated subquery resolves a non-null recipientRoleKey to this
    // tenant's contact_role_profiles.id (mirrors the migration's data-copy
    // subquery pattern). A null bound param returns no rows (id stays NULL),
    // matching recipient_kind='inspector'.
    //
    // SP2 cutover — the rule no longer carries its own copy (the columns that
    // used to hold it are dropped from the automations table entirely).
    // Instead this seeds a message_templates row per channel FIRST and the
    // automations INSERT below references it by id, mirroring ensureSeeds
    // (server/services/automation/core.ts).
    //
    // Every statement repeats the same NOT EXISTS lookup rather than sharing
    // one up-front SELECT, because the up-front-SELECT shape is exactly what
    // let two concurrent callers both observe "not seeded yet" and both write
    // — each statement here decides for itself, atomically, at the instant it
    // writes.
    const notExistsExisting = `
        NOT EXISTS (
            SELECT 1 FROM automations WHERE tenant_id = ? AND trigger = ?
                AND recipient_kind = (CASE WHEN ? IS NULL THEN 'inspector' ELSE 'role' END) AND name = ?
        )
    `;
    // message_templates timestamps are timestamp_ms (epoch milliseconds), same
    // as automations.created_at below — both computed the same way so neither
    // drifts from the other.
    const nowMsExpr = "CAST(unixepoch('now') * 1000 AS INTEGER)";
    const insertEmailTemplateStmt = `
        INSERT INTO message_templates (id, tenant_id, name, channel, subject, body, variables, is_seeded, created_at, updated_at)
        SELECT ?, ?, ?, 'email', ?, ?, ?, 1, ${nowMsExpr}, ${nowMsExpr}
        WHERE ${notExistsExisting}
    `;
    const insertSmsTemplateStmt = `
        INSERT INTO message_templates (id, tenant_id, name, channel, subject, body, variables, is_seeded, created_at, updated_at)
        SELECT ?, ?, ?, 'sms', NULL, ?, ?, 1, ${nowMsExpr}, ${nowMsExpr}
        WHERE ${notExistsExisting}
    `;
    const insertAutomationStmt = `
        INSERT INTO automations (id, tenant_id, trigger, recipient_kind, recipient_role_profile_id, name, delay_minutes, email_template_id, is_active, channels, sms_template_id, is_default, created_at)
        SELECT ${SQL_UUID_V4}, ?, ?, CASE WHEN ? IS NULL THEN 'inspector' ELSE 'role' END,
            (SELECT crp.id FROM contact_role_profiles crp WHERE crp.tenant_id = ? AND crp.key = ? AND crp.is_active = 1 LIMIT 1),
            ?, 0, ?, ?, '["email"]', ?, 1, ${nowMsExpr}
        WHERE ${notExistsExisting}
    `;
    for (const [trigger, recipientRoleKey, name, subject, body, active, smsBody] of rows) {
        try {
            const emailTemplateId = nanoid();
            const statements = [
                db.prepare(insertEmailTemplateStmt).bind(
                    emailTemplateId, tenantId, `${name} — Email`, subject, body, JSON.stringify(extractVars(subject, body)),
                    tenantId, trigger, recipientRoleKey, name,
                ),
            ];

            let smsTemplateId: string | null = null;
            if (smsBody?.trim()) {
                smsTemplateId = nanoid();
                statements.push(
                    db.prepare(insertSmsTemplateStmt).bind(
                        smsTemplateId, tenantId, `${name} — SMS`, smsBody, JSON.stringify(extractVars(smsBody)),
                        tenantId, trigger, recipientRoleKey, name,
                    ),
                );
            }

            statements.push(
                db.prepare(insertAutomationStmt).bind(
                    tenantId, trigger, recipientRoleKey,
                    tenantId, recipientRoleKey,
                    name, emailTemplateId, active, smsTemplateId,
                    tenantId, trigger, recipientRoleKey, name,
                ),
            );

            // One transaction per row: either every statement writes (the rule
            // did not exist yet) or every guard evaluates false and none does
            // (it did) — never a partial commit that leaves a template with
            // nothing referencing it.
            await db.batch(statements);
        } catch (err) {
            logger.warn('seedDefaultAutomations.row.failed', {
                tenantId, trigger, name,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }
}
