import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';

const TENANT = '00000000-0000-0000-0000-0000000000a1';
let db: BetterSQLite3Database<typeof schema>;

beforeEach(async () => {
    const fx = createTestDb();
    db = fx.db;
    await setupSchema(fx.sqlite);
    await db.insert(schema.tenants).values({ id: TENANT, slug: 'a1', createdAt: new Date() });
});

const config = () => db.select().from(schema.tenantConfigs)
    .where(eq(schema.tenantConfigs.tenantId, TENANT)).get();

/**
 * ⚠️ A describe block stood here, and what it was doing is worth recording.
 *
 * It asserted that `ai_key_attestation_endpoint`, `_model`, `_service_tier`,
 * `_intended_use` and `_config_version` round-tripped — the "record the
 * destination, not just the key" half of the attestation. Every one of those
 * assertions passed, and none of them meant anything: `AiKeyAttestationRecord`
 * carries no such fields, so the secrets save could not write them even in
 * principle. **This spec was the only thing that had ever put a value in those
 * five columns**, and it was inserting them with Drizzle and reading them back,
 * which proves SQLite stores what you give it.
 *
 * They were left behind when the AI fields moved to `tenant_ai_configs` /
 * `tenant_ai_attestations`, so the assertions went with them. What the live
 * attestation actually records is covered in
 * `tests/unit/secrets/byo-ai-attestation.spec.ts`, against the save path rather
 * than against the table.
 *
 * The version-starts-at-zero case moved too, to `ai-config-save.spec.ts`, where
 * it now says what is true after the split: there is no row, and therefore no
 * version, until the first save.
 */

describe('provenance answers which configuration was in force', () => {
    it('records the configuration version alongside the backend that ran', async () => {
        // A workspace configures one endpoint today and another tomorrow.
        // Which destination processed THIS inspection data? `provider` answers
        // the backend, observed off the adapter rather than inferred; the
        // version answers under which configuration, and links the call to
        // what was attested.
        await db.insert(schema.aiCallProvenance).values({
            id: 'call-1', tenantId: TENANT,
            capability: 'assist', provider: 'api.example.test', mode: 'byo',
            model: 'a-model', promptVersion: 'p.v1',
            createdAt: new Date(1_700_000_000_000),
            configVersion: 3,
        });
        const row = await db.select().from(schema.aiCallProvenance).get();
        expect(row).toMatchObject({ provider: 'api.example.test', configVersion: 3 });
    });

    it('accepts a null configuration version rather than inventing one', async () => {
        // Rows written before the column existed, and the managed path, whose
        // destination is the deployment's and does not move per workspace. A
        // zero here would be a claim that version 0 was in force, which is a
        // different statement from "not recorded".
        await db.insert(schema.aiCallProvenance).values({
            id: 'call-2', tenantId: TENANT,
            capability: 'assist', provider: 'api.example.test', mode: 'managed',
            model: 'a-model', promptVersion: 'p.v1',
            createdAt: new Date(1_700_000_000_000),
        });
        const row = await db.select().from(schema.aiCallProvenance).get();
        expect(row!.configVersion).toBeNull();
    });

    it('still has no field that could carry the prompt', () => {
        // The enforcement the schema comment describes — asserted rather than
        // trusted, because this change widens the table.
        const columns = Object.keys(schema.aiCallProvenance);
        expect(columns.some(c => /prompt|text|content|body|input/i.test(c)
            && c !== 'promptVersion')).toBe(false);
    });
});
