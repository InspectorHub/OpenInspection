import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';

const TENANT = '00000000-0000-0000-0000-0000000000c1';
let db: BetterSQLite3Database<typeof schema>;

beforeEach(async () => {
    const fx = createTestDb();
    db = fx.db;
    await setupSchema(fx.sqlite);
    await db.insert(schema.tenants).values({ id: TENANT, slug: 'c1', createdAt: new Date() });
});

const config = () => db.select().from(schema.tenantAiConfigs)
    .where(eq(schema.tenantAiConfigs.tenantId, TENANT)).get();

describe('tenant AI provider configuration', () => {
    it('defaults to enabled, so existing workspaces are unaffected by the table arriving', async () => {
        await db.insert(schema.tenantAiConfigs).values({ tenantId: TENANT, updatedAt: new Date() });
        expect(config()!.isEnabled).toBe(true);
    });

    it('leaves the endpoint and model unset until somebody sets them', async () => {
        // The positive control on "defaults to enabled": a migration that
        // filled every new column with a value would pass the assertion above
        // and quietly point every workspace at a destination nobody chose.
        //
        // `provider_kind` used to be asserted here too. It did not come across
        // when these fields moved to their own table: an enum with one member
        // that no code path ever set, so the only thing that had ever written
        // it was this line.
        await db.insert(schema.tenantAiConfigs).values({ tenantId: TENANT, updatedAt: new Date() });
        expect(config()).toMatchObject({
            baseUrl: null,
            model: null,
        });
    });

    it('stores a base URL and model', async () => {
        await db.insert(schema.tenantAiConfigs).values({
            tenantId: TENANT, updatedAt: new Date(),
            baseUrl: 'https://api.example.com/openai/v1',
            model: 'a-model',
        });
        expect(config()).toMatchObject({
            baseUrl: 'https://api.example.com/openai/v1',
            model: 'a-model',
        });
    });

    it('keeps base URL and model when AI is switched off', async () => {
        // The whole point of the flag: turning AI back on must not require
        // re-entering anything. "Off" is not a way to remove a credential.
        await db.insert(schema.tenantAiConfigs).values({
            tenantId: TENANT, updatedAt: new Date(),
            baseUrl: 'https://api.example.com/openai/v1',
            model: 'a-model',
        });
        await db.update(schema.tenantAiConfigs).set({ isEnabled: false })
            .where(eq(schema.tenantAiConfigs.tenantId, TENANT));

        expect(config()).toMatchObject({
            isEnabled: false,
            baseUrl: 'https://api.example.com/openai/v1',
            model: 'a-model',
        });
    });
});
