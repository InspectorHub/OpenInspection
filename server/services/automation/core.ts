import { eq, and, inArray, max } from 'drizzle-orm';
import { automations, contactRoleProfiles, smsDisclosureVersions, messageTemplates } from '../../lib/db/schema';
import { AUTOMATION_SEEDS } from '../../data/automation-seeds';
import { nanoid } from 'nanoid';
import { Errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { extractVars } from '../message-template-backfill';
import { SMS_DISCLOSURE_V1, AUTOMATION_CHANNELS, type AutomationChannel, type RecipientKind, type Constructor } from './shared';
import type { AutomationBase } from './shared';

/**
 * Core CRUD mixin: seeding (incl. the regulatory SMS disclosure v1 ledger row),
 * list/create/update/delete, row serialization, and the `parseChannels` helper
 * (kept here so every later mixin in the chain can read it). Bodies are
 * byte-identical to the former monolith.
 */
export function AutomationCore<TBase extends Constructor<AutomationBase>>(Base: TBase) {
    return class extends Base {
        async ensureSeeds(tenantId: string): Promise<void> {
            const db = this.getDrizzle();
            // Track L — ensure the global SMS disclosure v1 exists (guarded; idempotent).
            // Tenant-independent: the disclosure ledger is platform-wide, so a max-version
            // check keeps re-runs (and concurrent tenants) from creating a 2nd version.
            await this.ensureSmsDisclosureV1();

            const existing = await db.select().from(automations)
                .where(and(eq(automations.tenantId, tenantId), eq(automations.isDefault, true)));
            if (existing.length < AUTOMATION_SEEDS.length) {
                const toInsert = AUTOMATION_SEEDS.filter(
                    seed => !existing.some(e => e.name === seed.name && e.trigger === seed.trigger)
                );
                if (toInsert.length > 0) {
                    // Resolve every recipientRoleKey this batch needs to its per-tenant
                    // contact_role_profiles.id in one query. Role profiles are seeded
                    // ahead of automations on both the /setup and starter-content paths,
                    // so this map is normally fully populated; a seed whose key is still
                    // missing is skipped below (not inserted with a null profile id) and
                    // picked up on the next ensureSeeds call once the profile exists.
                    // Not every seed targets a role — B3's staff alerts address
                    // `users` and carry no role key at all.
                    const neededKeys: string[] = [...new Set(
                        toInsert.flatMap(s =>
                            'recipientRoleKey' in s && typeof s.recipientRoleKey === 'string'
                                ? [s.recipientRoleKey as string]
                                : [],
                        ),
                    )];
                    const profileRows = neededKeys.length
                        ? await db.select({ key: contactRoleProfiles.key, id: contactRoleProfiles.id })
                            .from(contactRoleProfiles)
                            .where(and(
                                eq(contactRoleProfiles.tenantId, tenantId),
                                eq(contactRoleProfiles.active, true),
                                inArray(contactRoleProfiles.key, neededKeys),
                            ))
                        : [];
                    const profileIdByKey = new Map(profileRows.map(r => [r.key, r.id]));

                    // D1 caps prepared-statement bind parameters at 100. Each row now binds
                    // 13 columns — id, tenantId, name, trigger, recipientKind,
                    // recipientRoleProfileId, delayMinutes, channels, emailTemplateId,
                    // smsTemplateId, active, isDefault, createdAt (the seed now inserts its
                    // own message_templates row(s) up front and carries only their ids;
                    // subjectTemplate/bodyTemplate/smsBody are no longer written here) — so
                    // chunk to 7 rows / 91 binds per insert (under the 100 cap).
                    const CHUNK_SIZE = 7;
                    const rows: (typeof automations.$inferInsert)[] = [];
                    for (const seed of toInsert) {
                        const seedRoleKey = 'recipientRoleKey' in seed ? seed.recipientRoleKey : null;
                        let recipientRoleProfileId: string | null = null;
                        if (seedRoleKey) {
                            recipientRoleProfileId = profileIdByKey.get(seedRoleKey) ?? null;
                            if (!recipientRoleProfileId) {
                                logger.warn('AutomationService.ensureSeeds: role profile not yet seeded, skipping rule (will retry)',
                                    { tenantId, name: seed.name, recipientRoleKey: seedRoleKey });
                                continue;
                            }
                        }

                        // Seed the message_templates row(s) BEFORE the automation row, since
                        // the row now carries their ids rather than the copy itself. Naming
                        // (`${seed.name} — Email`/`— SMS`), the `isSeeded: true` flag, and the
                        // extractVars call are copied deliberately from
                        // backfillAutomationTemplates so a tenant seeded via this path is
                        // indistinguishable from one built by the old copy-then-backfill path.
                        const chans: string[] = (seed as { channels?: string[] }).channels ?? ['email'];
                        const now = new Date();
                        let emailTemplateId: string | null = null;
                        let smsTemplateId: string | null = null;

                        if (chans.includes('email')) {
                            emailTemplateId = nanoid();
                            await db.insert(messageTemplates).values({
                                id: emailTemplateId, tenantId, name: `${seed.name} — Email`, channel: 'email',
                                subject: seed.subjectTemplate, body: seed.bodyTemplate,
                                variables: JSON.stringify(extractVars(seed.subjectTemplate, seed.bodyTemplate)),
                                isSeeded: true, createdAt: now, updatedAt: now,
                            });
                        }
                        const seedSms = (seed as { smsBody?: string }).smsBody;
                        if (chans.includes('sms') && seedSms?.trim()) {
                            smsTemplateId = nanoid();
                            await db.insert(messageTemplates).values({
                                id: smsTemplateId, tenantId, name: `${seed.name} — SMS`, channel: 'sms',
                                subject: null, body: seedSms,
                                variables: JSON.stringify(extractVars(seedSms)),
                                isSeeded: true, createdAt: now, updatedAt: now,
                            });
                        }

                        rows.push({
                            id:              nanoid(),
                            tenantId,
                            name:            seed.name,
                            trigger:         seed.trigger,
                            recipientKind:   seed.recipientKind,
                            recipientRoleProfileId,
                            delayMinutes:    seed.delayMinutes,
                            channels:        JSON.stringify(chans),
                            emailTemplateId,
                            smsTemplateId,
                            active:          (seed as { defaultActive?: boolean }).defaultActive ?? true,
                            isDefault:       true,
                            createdAt:       now,
                        });
                    }
                    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
                        await db.insert(automations).values(rows.slice(i, i + CHUNK_SIZE));
                    }
                    if (rows.length > 0) {
                        logger.info('AutomationService: seeded default rules', { tenantId, count: rows.length });
                    }
                }
            }

            // SP2 — give every rule a referenced template (idempotent; runs for existing
            // tenants too, not just freshly-seeded ones).
            const { backfillAutomationTemplates } = await import('../message-template-backfill');
            await backfillAutomationTemplates(this.db, tenantId);
        }

        // Track L (D7) — seed the default TCPA disclosure (version 1) once. Guarded by
        // a max-version check so re-running ensureSeeds never creates a duplicate.
        public async ensureSmsDisclosureV1(): Promise<void> {
            const db = this.getDrizzle();
            const cur = await db.select({ v: max(smsDisclosureVersions.version) })
                .from(smsDisclosureVersions).get();
            if ((cur?.v ?? 0) >= 1) return;
            await db.insert(smsDisclosureVersions).values({
                version:     1,
                text:        SMS_DISCLOSURE_V1,
                publishedAt: new Date(),
            });
        }

        async list(tenantId: string) {
            const db = this.getDrizzle();
            const rows = await db.select().from(automations).where(eq(automations.tenantId, tenantId));
            // Track L (A) — the `channels` column is a JSON STRING at rest, but the API
            // surface (AutomationSchema) types it as string[]. Parse on output so the
            // BFF / typed client see a truthful array.
            return rows.map((r) => this.serializeRow(r));
        }

        /**
         * Track L (A) — project a raw automations row to the API shape, parsing the
         * JSON `channels` column to a `string[]`. Keeps the typed response honest
         * (AutomationSchema.channels is `string[]`) without changing the DB column.
         */
        public serializeRow<T extends { channels: string | null }>(row: T): Omit<T, 'channels'> & { channels: AutomationChannel[] } {
            const { channels, ...rest } = row;
            return { ...rest, channels: this.parseChannels(channels) };
        }

        /**
         * `channels` is typed `AutomationChannel[]`, derived from the column, not a
         * hand-written `('email' | 'sms')[]`: `in_app` (B1) is a first-class channel
         * and the literal pair silently excluded it. Every optional property spells
         * `| undefined` because the API layer hands us Zod `.optional()` output,
         * where an absent key IS `T | undefined`; the body already normalizes both
         * (`?? null`, truthiness) so accepting it is a statement of fact, not a
         * loosening. Without it, exactOptionalPropertyTypes rejects the caller.
         */
        async create(tenantId: string, data: {
            name: string; trigger: string;
            recipientKind: RecipientKind; recipientRoleProfileId?: string | null | undefined;
            delayMinutes: number;
            conditions?: {
                requirePaid?: boolean | undefined;
                requireSigned?: boolean | undefined;
                serviceIds?: string[] | undefined;
            } | null | undefined;
            channels?: AutomationChannel[] | undefined;
            emailTemplateId?: string | null | undefined; smsTemplateId?: string | null | undefined;
        }) {
            const db = this.getDrizzle();
            const id = nanoid();
            const { conditions, channels, emailTemplateId, smsTemplateId, recipientRoleProfileId, ...rest } = data;
            await db.insert(automations).values({
                id, tenantId, ...rest,
                // Cast narrows the public string param to the schema's enum literal
                // union; runtime values are validated by the API zod schema.
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                trigger:   rest.trigger as any,
                recipientRoleProfileId: recipientRoleProfileId ?? null,
                conditions: conditions ? JSON.stringify(conditions) : null,
                // Track L — channels is the live field; the dead `channel` column is left
                // to its DB default ('email') so its NOT NULL constraint stays satisfied.
                channels: JSON.stringify(channels?.length ? channels : ['email']),
                // SP2 — template ids; the rule references a message_templates row per
                // channel rather than carrying the copy itself.
                emailTemplateId: emailTemplateId ?? null,
                smsTemplateId:   smsTemplateId ?? null,
                active: true, isDefault: false, createdAt: new Date(),
            });
            // Track L (A) — parse channels on output to match the typed API shape.
            return this.serializeRow((await db.select().from(automations).where(eq(automations.id, id)))[0]);
        }

        async update(tenantId: string, id: string, data: Partial<{
            name: string; trigger: string;
            recipientKind: RecipientKind; recipientRoleProfileId: string | null;
            delayMinutes: number; active: boolean;
            conditions: { requirePaid?: boolean; requireSigned?: boolean; serviceIds?: string[] } | null;
            channels: ('email' | 'sms')[];
            emailTemplateId: string | null; smsTemplateId: string | null;
        }>) {
            const db = this.getDrizzle();
            const existing = await db.select().from(automations)
                .where(and(eq(automations.id, id), eq(automations.tenantId, tenantId))).limit(1);
            if (!existing[0]) throw Errors.NotFound('Automation not found');
            const { conditions, channels, ...rest } = data;
            const patch: Record<string, unknown> = { ...rest };
            // Key-presence (not truthiness) so an explicit `conditions: null` clears
            // the row while an omitted key leaves it untouched. The zod layer strips
            // absent keys, so `undefined` should not reach here; the guard is belt-
            // and-braces for direct (non-API) callers.
            if ('conditions' in data) patch.conditions = conditions ? JSON.stringify(conditions) : null;
            // Track L — channels persists on the same key-presence contract.
            if ('channels' in data) patch.channels = JSON.stringify(channels?.length ? channels : ['email']);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- partial patch → table's typed columns; matches the file's create() cast pattern
            await db.update(automations).set(patch as any)
                .where(and(eq(automations.id, id), eq(automations.tenantId, tenantId)));
            // Track L (A) — parse channels on output to match the typed API shape.
            return this.serializeRow((await db.select().from(automations).where(eq(automations.id, id)))[0]);
        }

        async delete(tenantId: string, id: string): Promise<void> {
            const db = this.getDrizzle();
            const existing = await db.select().from(automations)
                .where(and(eq(automations.id, id), eq(automations.tenantId, tenantId))).limit(1);
            if (!existing[0]) throw Errors.NotFound('Automation not found');
            if (existing[0].isDefault) throw Errors.Forbidden('Cannot delete a default automation rule');
            await db.delete(automations).where(and(eq(automations.id, id), eq(automations.tenantId, tenantId)));
        }

        /**
         * Track L — parse the JSON `channels` column into a validated channel list.
         * Defends against malformed/empty JSON (or a NULL legacy row) by falling back
         * to email-only, so a corrupt blob never traps a rule from firing.
         */
        // Public (was `private` on the monolith) so later mixins in the chain can
        // call it through a typed cross-mixin contract; no runtime behavior change.
        parseChannels(raw: string | null): AutomationChannel[] {
            if (!raw) return ['email'];
            try {
                const arr = JSON.parse(raw);
                // Filtering against the known set (rather than trusting the
                // JSON) is what keeps a typo in the column from fanning out a
                // log row on a channel no delivery path handles.
                const valid = Array.isArray(arr)
                    ? arr.filter((c): c is AutomationChannel => AUTOMATION_CHANNELS.includes(c))
                    : [];
                return valid.length ? valid : ['email'];
            } catch { return ['email']; }
        }
    };
}
