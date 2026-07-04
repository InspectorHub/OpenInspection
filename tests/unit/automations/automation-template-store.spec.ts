import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createOiTemplateStore } from '../../../server/services/automation/template-store';
import { MessageTemplateService } from '../../../server/services/message-template.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const T = 'tenant-1';

describe('createOiTemplateStore', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    beforeEach(async () => {
        const fx = createTestDb(); testDb = fx.db; await setupSchema(fx.sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
    });

    it('resolves a template id to the port shape', async () => {
        const t = await new MessageTemplateService({} as D1Database).create(T, {
            name: 'X', channel: 'email', subject: 'S {{property_address}}',
            body: '<p>{{client_name}}</p>', variables: ['property_address', 'client_name'],
        });
        const store = createOiTemplateStore({} as D1Database);
        const r = await store.resolve(T, t.id);
        expect(r).toEqual({
            channel: 'email',
            subject: 'S {{property_address}}',
            body: '<p>{{client_name}}</p>',
            variables: ['property_address', 'client_name'],
        });
    });

    it('returns null for an unknown id and never crosses tenants', async () => {
        const t = await new MessageTemplateService({} as D1Database).create(T, {
            name: 'X', channel: 'sms', body: 's',
        });
        const store = createOiTemplateStore({} as D1Database);
        expect(await store.resolve('tenant-2', t.id)).toBeNull();
        expect(await store.resolve(T, 'nope')).toBeNull();
    });
});
