import { describe, it, expect } from 'vitest';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../server/lib/db/schema';

describe('email_byo_provider column', () => {
    it('tenant_configs row defaults emailByoProvider to "resend"', async () => {
        const fx = createTestDb();
        await setupSchema(fx.sqlite);

        // Insert a minimal tenant + config (emailByoProvider not specified — should default)
        fx.sqlite.exec(`INSERT INTO tenants (id, name, slug, created_at) VALUES ('t1', 'Test', 'test', ${Date.now()})`);
        await fx.db.insert(schema.tenantConfigs).values({
            tenantId: 't1',
            updatedAt: new Date(),
        } as never);

        const row = await fx.db.select().from(schema.tenantConfigs).get();
        expect(row?.emailByoProvider).toBe('resend');

        fx.sqlite.close();
    });
});
