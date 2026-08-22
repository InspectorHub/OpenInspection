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

describe('the attestation records the destination, not just the key', () => {
    it('stores endpoint, model, service tier and intended use beside the key facts', async () => {
        await db.insert(schema.tenantConfigs).values({
            tenantId: TENANT, updatedAt: new Date(),
            aiKeyAttestationProvider: 'openai_compatible',
            aiKeyAttestationEndpoint: 'https://api.example.test/openai/v1',
            aiKeyAttestationModel: 'a-model',
            aiKeyAttestationServiceTier: 'paid',
            aiKeyAttestationIntendedUse: 'inspection comment drafting',
            aiKeyAttestationConfigVersion: 3,
        });
        expect(config()).toMatchObject({
            aiKeyAttestationProvider: 'openai_compatible',
            aiKeyAttestationEndpoint: 'https://api.example.test/openai/v1',
            aiKeyAttestationModel: 'a-model',
            aiKeyAttestationServiceTier: 'paid',
            aiKeyAttestationConfigVersion: 3,
        });
    });

    it('starts the configuration version at zero, so an untouched workspace still has one', async () => {
        await db.insert(schema.tenantConfigs).values({ tenantId: TENANT, updatedAt: new Date() });
        expect(config()!.aiConfigVersion).toBe(0);
    });

    it('leaves every attestation field null until somebody attests', async () => {
        // The positive control on the default above: a migration that
        // backfilled these would make an attestation exist for a workspace
        // that never made one, which is the worst possible failure for a
        // record whose entire value is that a person stated it.
        await db.insert(schema.tenantConfigs).values({ tenantId: TENANT, updatedAt: new Date() });
        expect(config()).toMatchObject({
            aiKeyAttestationEndpoint: null,
            aiKeyAttestationModel: null,
            aiKeyAttestationServiceTier: null,
            aiKeyAttestationIntendedUse: null,
            aiKeyAttestationConfigVersion: null,
        });
    });
});

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
