import { eq, and, max } from 'drizzle-orm';
import { automations, smsDisclosureVersions } from '../../lib/db/schema';
import { AUTOMATION_SEEDS } from '../../data/automation-seeds';
import { nanoid } from 'nanoid';
import { Errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { SMS_DISCLOSURE_V1, type Constructor } from './shared';
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
            if (existing.length >= AUTOMATION_SEEDS.length) return;

            const toInsert = AUTOMATION_SEEDS.filter(
                seed => !existing.some(e => e.name === seed.name && e.trigger === seed.trigger)
            );
            if (toInsert.length === 0) return;

            // D1 caps prepared-statement bind parameters at 100. Each row now binds
            // 13 columns (Track L added channels + sms_body), so chunk to 7 rows /
            // 91 binds per insert (under the 100 cap).
            const CHUNK_SIZE = 7;
            const rows = toInsert.map(seed => ({
                id:              nanoid(),
                tenantId,
                name:            seed.name,
                trigger:         seed.trigger,
                recipient:       seed.recipient,
                delayMinutes:    seed.delayMinutes,
                subjectTemplate: seed.subjectTemplate,
                bodyTemplate:    seed.bodyTemplate,
                channels:        JSON.stringify((seed as { channels?: string[] }).channels ?? ['email']),
                smsBody:         (seed as { smsBody?: string }).smsBody ?? null,
                active:          (seed as { defaultActive?: boolean }).defaultActive ?? true,
                isDefault:       true,
                createdAt:       new Date(),
            }));
            for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
                await db.insert(automations).values(rows.slice(i, i + CHUNK_SIZE));
            }
            logger.info('AutomationService: seeded default rules', { tenantId, count: toInsert.length });
        }

        // Track L (D7) — seed the default TCPA disclosure (version 1) once. Guarded by
        // a max-version check so re-running ensureSeeds never creates a duplicate.
        protected async ensureSmsDisclosureV1(): Promise<void> {
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
        protected serializeRow<T extends { channels: string | null }>(row: T): Omit<T, 'channels'> & { channels: ('email' | 'sms')[] } {
            const { channels, ...rest } = row;
            return { ...rest, channels: this.parseChannels(channels) };
        }

        async create(tenantId: string, data: {
            name: string; trigger: string; recipient: string;
            delayMinutes: number; subjectTemplate: string; bodyTemplate: string;
            conditions?: { requirePaid?: boolean; requireSigned?: boolean; serviceIds?: string[] } | null;
            channels?: ('email' | 'sms')[]; smsBody?: string | null;
        }) {
            const db = this.getDrizzle();
            const id = nanoid();
            const { conditions, channels, smsBody, ...rest } = data;
            await db.insert(automations).values({
                id, tenantId, ...rest,
                // Casts narrow the public string param to the schema's enum literal
                // union; runtime values are validated by the API zod schema.
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                trigger:   rest.trigger as any,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                recipient: rest.recipient as any,
                conditions: conditions ? JSON.stringify(conditions) : null,
                // Track L — channels is the live field; the dead `channel` column is left
                // to its DB default ('email') so its NOT NULL constraint stays satisfied.
                channels: JSON.stringify(channels?.length ? channels : ['email']),
                smsBody:  smsBody ?? null,
                active: true, isDefault: false, createdAt: new Date(),
            });
            // Track L (A) — parse channels on output to match the typed API shape.
            return this.serializeRow((await db.select().from(automations).where(eq(automations.id, id)))[0]);
        }

        async update(tenantId: string, id: string, data: Partial<{
            name: string; trigger: string; recipient: string;
            delayMinutes: number; subjectTemplate: string; bodyTemplate: string; active: boolean;
            conditions: { requirePaid?: boolean; requireSigned?: boolean; serviceIds?: string[] } | null;
            channels: ('email' | 'sms')[]; smsBody: string | null;
        }>) {
            const db = this.getDrizzle();
            const existing = await db.select().from(automations)
                .where(and(eq(automations.id, id), eq(automations.tenantId, tenantId))).limit(1);
            if (!existing[0]) throw Errors.NotFound('Automation not found');
            const { conditions, channels, smsBody, ...rest } = data;
            const patch: Record<string, unknown> = { ...rest };
            // Key-presence (not truthiness) so an explicit `conditions: null` clears
            // the row while an omitted key leaves it untouched. The zod layer strips
            // absent keys, so `undefined` should not reach here; the guard is belt-
            // and-braces for direct (non-API) callers.
            if ('conditions' in data) patch.conditions = conditions ? JSON.stringify(conditions) : null;
            // Track L — channels/sms_body persist on the same key-presence contract.
            if ('channels' in data) patch.channels = JSON.stringify(channels?.length ? channels : ['email']);
            if ('smsBody' in data) patch.smsBody = smsBody ?? null;
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
        parseChannels(raw: string | null): ('email' | 'sms')[] {
            if (!raw) return ['email'];
            try {
                const arr = JSON.parse(raw);
                const valid = Array.isArray(arr) ? arr.filter((c) => c === 'email' || c === 'sms') : [];
                return valid.length ? valid : ['email'];
            } catch { return ['email']; }
        }
    };
}
