import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { drizzle } from 'drizzle-orm/d1';
import { createTestDb, setupSchema, toRawD1 } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { keyForProbe, saveAiConfig } from '../../../server/lib/ai/config-write';

const TENANT = '00000000-0000-0000-0000-0000000000d1';
let db: BetterSQLite3Database<typeof schema>;
/** The functions under test take the D1 handle their only caller holds; `db`
 *  above stays for assertions, which read more clearly through the schema. */
let d1: ReturnType<typeof drizzle>;

beforeEach(async () => {
    const fx = createTestDb();
    db = fx.db;
    d1 = drizzle(toRawD1(fx.sqlite));
    await setupSchema(fx.sqlite);
    await db.insert(schema.tenants).values({ id: TENANT, slug: 'd1', createdAt: new Date() });
    await db.insert(schema.tenantConfigs).values({ tenantId: TENANT, updatedAt: new Date() });
});

const config = () => db.select().from(schema.tenantConfigs)
    .where(eq(schema.tenantConfigs.tenantId, TENANT)).get();

describe('saveAiConfig', () => {
    it('stores the endpoint and model the workspace submitted', async () => {
        await saveAiConfig(d1, TENANT, {
            aiEnabled: true,
            aiBaseUrl: 'https://api.groq.com/openai/v1',
            aiModel: 'llama-3.3-70b',
        });
        const c = config()!;
        expect(c.aiBaseUrl).toBe('https://api.groq.com/openai/v1');
        expect(c.aiModel).toBe('llama-3.3-70b');
        expect(c.aiEnabled).toBe(true);
    });

    /**
     * The version is what lets a caller holding a resolved endpoint know it is
     * holding a stale one. Without the bump the column is a number that never
     * moves, and every consumer of it is reading a value that cannot answer the
     * question it exists to answer.
     */
    it('bumps the config version on every save', async () => {
        expect(config()!.aiConfigVersion).toBe(0);
        await saveAiConfig(d1, TENANT, { aiEnabled: true, aiBaseUrl: 'https://a/v1', aiModel: 'm' });
        expect(config()!.aiConfigVersion).toBe(1);
        await saveAiConfig(d1, TENANT, { aiEnabled: true, aiBaseUrl: 'https://b/v1', aiModel: 'm' });
        expect(config()!.aiConfigVersion).toBe(2);
    });

    /**
     * The switch's helper text promises "Turning this off keeps your key and
     * settings." Nothing but this enforces it, and a save path that cleared the
     * endpoint on the way to storing `false` would make the copy a lie while
     * every other assertion here still passed.
     */
    it('turning AI off keeps the endpoint and model that were already stored', async () => {
        await saveAiConfig(d1, TENANT, {
            aiEnabled: true,
            aiBaseUrl: 'https://api.groq.com/openai/v1',
            aiModel: 'llama-3.3-70b',
        });
        await saveAiConfig(d1, TENANT, {
            aiEnabled: false,
            aiBaseUrl: 'https://api.groq.com/openai/v1',
            aiModel: 'llama-3.3-70b',
        });
        const c = config()!;
        expect(c.aiEnabled).toBe(false);
        expect(c.aiBaseUrl).toBe('https://api.groq.com/openai/v1');
        expect(c.aiModel).toBe('llama-3.3-70b');
    });

    /**
     * An empty box means "unset", not the empty string. `resolveAi` branches on
     * null; a stored '' would be a configured endpoint that resolves to nothing
     * and refuses with the wrong reason.
     */
    it('stores a blank endpoint or model as null rather than an empty string', async () => {
        await saveAiConfig(d1, TENANT, { aiEnabled: true, aiBaseUrl: '  ', aiModel: '' });
        const c = config()!;
        expect(c.aiBaseUrl).toBeNull();
        expect(c.aiModel).toBeNull();
    });

    it('writes nothing for another tenant', async () => {
        const other = '00000000-0000-0000-0000-0000000000d2';
        await db.insert(schema.tenants).values({ id: other, slug: 'd2', createdAt: new Date() });
        await db.insert(schema.tenantConfigs).values({ tenantId: other, updatedAt: new Date() });
        await saveAiConfig(d1, TENANT, { aiEnabled: false, aiBaseUrl: 'https://a/v1', aiModel: 'm' });
        const untouched = db.select().from(schema.tenantConfigs)
            .where(eq(schema.tenantConfigs.tenantId, other)).get()!;
        expect(untouched.aiBaseUrl).toBeNull();
        expect(untouched.aiConfigVersion).toBe(0);
        expect(untouched.aiEnabled).toBe(true);
    });
});

describe('keyForProbe', () => {
    it('probes with the key the workspace just typed', () => {
        expect(keyForProbe('typed', 'stored')).toEqual({ key: 'typed' });
    });

    /**
     * A workspace that saved a key and came back to test it has an empty box —
     * SecretField submits nothing it was never given. Refusing here would make
     * the button untestable for exactly the configuration most likely to be
     * tested: the one already in use.
     */
    it('falls back to the stored key when the box was left empty', () => {
        expect(keyForProbe('', 'stored')).toEqual({ key: 'stored' });
        expect(keyForProbe('   ', 'stored')).toEqual({ key: 'stored' });
    });

    /**
     * The fallback is to the WORKSPACE's key and nothing else. The endpoint this
     * replaced probed a deployment environment variable, which is how it could
     * report success for a configuration no tenant call ever used.
     */
    it('refuses rather than probing when neither exists', () => {
        expect(keyForProbe('', null)).toEqual({ refuse: 'apiKey' });
        expect(keyForProbe('', '')).toEqual({ refuse: 'apiKey' });
    });
});
