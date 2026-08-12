import { nanoid } from 'nanoid';
import { logger } from '../logger';
import { extractVars } from '../../services/message-template-backfill';
import { AUTOMATION_SEEDS } from '../../data/automation-seeds';
import { SQL_UUID_V4 } from './standalone-uuid';

// Default automation rules seeded for every new tenant. Without these, none of
// the lifecycle emails (booking confirm, report ready, agreement nag, invoice,
// payment receipt) actually fire. Schema constrains `trigger` to a fixed enum
// (see the `automations` table in schema) and each row targets a single
// recipient discriminator (recipient_kind + recipient_role_profile_id), so
// multi-recipient intents fan out into one row per recipient.
//
// ONE RULE LIST, NOT TWO. The rows come from `AUTOMATION_SEEDS`
// (server/data/automation-seeds.ts) — the same list `AutomationCore.ensureSeeds`
// inserts on the SaaS path, `backfillAutomationTemplates` recovers copy from,
// and `automation-classes.ts` names its notification classes off. This file
// used to keep its own parallel copy under a comment asking the reader to keep
// the two "semantically in sync", and they had already drifted: six rules
// carried a different name here than in the seed list, so a standalone tenant
// got each of them seeded a SECOND time under the other name the first time
// ensureSeeds ran (it dedupes on name+trigger). Two active rules on one
// trigger means the client receives the mail twice. The copy is gone; what is
// left below is only the raw-SQL WRITER, which is what this path actually
// needs that ensureSeeds cannot give it.
//
// Idempotent: every INSERT below (both message_templates writes and the
// automations write) carries its own `WHERE NOT EXISTS` guard against the
// same (tenant_id, trigger, name) lookup, evaluated by the database at write
// time — so two concurrent callers can no longer both pass a check and
// double-seed the same rule. That triple is exactly the identity ensureSeeds
// diffs on, so whichever path runs second recognises the other's rows. The
// three statements for one row are additionally run in a single db.batch() so
// a failure partway through (e.g. the automations insert) cannot leave that
// row's templates committed with nothing referencing them.
//
// Implemented as a per-row JS loop because D1 caps compound SELECT terms
// (~10) so a prior single-statement INSERT … SELECT … UNION ALL fan-out
// raised SQLITE_ERROR "too many terms in compound SELECT" at run time.
//
// PREREQUISITE: this runs from handleTenantUpdate (StandaloneProvider), which
// executes BEFORE seedStarterContent → seedRoleProfiles in the /setup flow
// (server/api/auth.ts). The caller seeds role profiles first so the
// recipientRoleKey → contact_role_profiles.id subquery has rows to find.

/**
 * The seed fields this writer reads. `AUTOMATION_SEEDS` is `as const` with a
 * union of row shapes (only some entries carry `recipientRoleKey`, `smsBody`,
 * `channels` or `defaultActive`), so it is widened once here rather than at
 * every access.
 */
type SeedRow = {
    name:             string;
    trigger:          string;
    recipientKind:    'role' | 'inspector' | 'all' | 'staff';
    recipientRoleKey?: string | null;
    delayMinutes:     number;
    subjectTemplate:  string;
    bodyTemplate:     string;
    smsBody?:         string;
    channels?:        readonly string[];
    defaultActive?:   boolean;
};

export async function seedDefaultAutomations(db: D1Database, tenantId: string): Promise<void> {
    // The correlated subquery resolves a non-null recipientRoleKey to this
    // tenant's contact_role_profiles.id (mirrors the migration's data-copy
    // subquery pattern). A null bound param returns no rows (id stays NULL),
    // which is what every non-`role` recipient kind wants.
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
            SELECT 1 FROM automations WHERE tenant_id = ? AND trigger = ? AND name = ?
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
        SELECT ${SQL_UUID_V4}, ?, ?, ?,
            (SELECT crp.id FROM contact_role_profiles crp WHERE crp.tenant_id = ? AND crp.key = ? AND crp.is_active = 1 LIMIT 1),
            ?, ?, ?, ?, ?, ?, 1, ${nowMsExpr}
        WHERE ${notExistsExisting}
    `;
    for (const raw of AUTOMATION_SEEDS) {
        const seed = raw as unknown as SeedRow;
        const { name, trigger, subjectTemplate, bodyTemplate } = seed;
        try {
            // Channel gating is copied from `backfillAutomationTemplates`, which
            // states the rule this file used to break: a template row for a
            // channel the rule does not carry is a row in the operator's
            // template library that nothing can ever send. Every seed is
            // email-only or in-app-only today, so the sms branch is dormant —
            // it stays because the gate, not the emptiness, is the invariant.
            // (in_app wording is left to backfillAutomationTemplates, exactly as
            // ensureSeeds leaves it.)
            const channels = seed.channels ? [...seed.channels] : ['email'];
            const roleKey = seed.recipientKind === 'role' ? (seed.recipientRoleKey ?? null) : null;
            const statements = [];

            let emailTemplateId: string | null = null;
            if (channels.includes('email')) {
                emailTemplateId = nanoid();
                statements.push(
                    db.prepare(insertEmailTemplateStmt).bind(
                        emailTemplateId, tenantId, `${name} — Email`, subjectTemplate, bodyTemplate,
                        JSON.stringify(extractVars(subjectTemplate, bodyTemplate)),
                        tenantId, trigger, name,
                    ),
                );
            }

            let smsTemplateId: string | null = null;
            if (channels.includes('sms') && seed.smsBody?.trim()) {
                smsTemplateId = nanoid();
                statements.push(
                    db.prepare(insertSmsTemplateStmt).bind(
                        smsTemplateId, tenantId, `${name} — SMS`, seed.smsBody,
                        JSON.stringify(extractVars(seed.smsBody)),
                        tenantId, trigger, name,
                    ),
                );
            }

            statements.push(
                db.prepare(insertAutomationStmt).bind(
                    tenantId, trigger, seed.recipientKind,
                    tenantId, roleKey,
                    name, seed.delayMinutes, emailTemplateId,
                    seed.defaultActive === false ? 0 : 1,
                    JSON.stringify(channels), smsTemplateId,
                    tenantId, trigger, name,
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
