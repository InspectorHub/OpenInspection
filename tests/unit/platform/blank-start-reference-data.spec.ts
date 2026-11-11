/**
 * What a workspace started without the bundled content still gains on first use.
 *
 * Tags, rating systems and defect categories are reference data the screens rely
 * on, so each is filled in lazily the first time it is read. This pins that
 * behaviour so the wording of the empty-start option stays true: if one of these
 * stops filling itself in, this fails and the wording can change with it.
 * It also pins the install action's effect on the empty-start stamp.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import { toD1Binding } from '../helpers/d1-binding';
import * as schema from '../../../server/lib/db/schema';
import { tenants, tags, ratingSystems, defectCategories } from '../../../server/lib/db/schema';
import { StandaloneProvider } from '../../../server/lib/integration/standalone';
import { TagService } from '../../../server/services/tag.service';
import { RatingSystemService } from '../../../server/services/rating-system.service';
import { DefectCategoryService } from '../../../server/services/inspection/defect-category.service';
import { NO_STARTER_CONTENT, STARTER_CONTENT_VERSION } from '../../../server/services/starter-content/content-version';
import installRoutes from '../../../server/api/admin/admin-content-install';
import type { HonoConfig } from '../../../server/types/hono';

vi.mock('../../../server/lib/audit', async (importOriginal) => ({
    ...await importOriginal<typeof import('../../../server/lib/audit')>(),
    auditFromContext: () => undefined,
}));

const TENANT = '00000000-0000-0000-0000-0000000000e1';
const OTHER = '00000000-0000-0000-0000-0000000000e2';

let db: BetterSQLite3Database<typeof schema>;
let binding: D1Database;

beforeEach(async () => {
    const fix = createTestDb();
    db = fix.db;
    binding = toD1Binding(fix.sqlite);
    await setupSchema(fix.sqlite);
});

const blankSetup = () => new StandaloneProvider(binding).handleTenantUpdate({
    id: TENANT, slug: 'acme', status: 'active', name: 'Acme', startEmpty: true,
    adminEmail: 'owner@example.com', adminPasswordHash: 'pbkdf2:x:y', adminName: 'Owner',
});

describe('reference data on an empty-start workspace', () => {
    it('is absent after setup', async () => {
        await blankSetup();
        expect(db.select().from(tags).all()).toHaveLength(0);
        expect(db.select().from(ratingSystems).all()).toHaveLength(0);
        expect(db.select().from(defectCategories).all()).toHaveLength(0);
    });

    it('tags appear when the list is first read', async () => {
        await blankSetup();
        expect((await new TagService(binding).listWithDefaults(TENANT)).length).toBeGreaterThan(0);
    });

    it('rating systems appear when the list is first read', async () => {
        await blankSetup();
        await new RatingSystemService(binding).seedDefaults(TENANT);
        expect(db.select().from(ratingSystems).all().length).toBeGreaterThan(0);
    });

    it('defect categories appear when the list is first read', async () => {
        await blankSetup();
        expect((await new DefectCategoryService(binding).ensureSeed(TENANT)).length).toBeGreaterThan(0);
    });
});

describe('Install what\'s new on an empty-start workspace', () => {
    const install = (tenantId: string) => {
        const app = new OpenAPIHono<HonoConfig>();
        app.use('*', async (c, next) => {
            c.set('tenantId', tenantId);
            c.set('userRole', 'owner');
            await next();
        });
        app.route('/api/admin', installRoutes);
        return app.request('/api/admin/data/install-bundled-content', { method: 'POST' },
            { DB: binding } as unknown as HonoConfig['Bindings']);
    };
    const stamp = (id: string) => db.select().from(tenants).where(eq(tenants.id, id)).get()?.contentVersion;
    const addTenant = (id: string, contentVersion: string | null) =>
        db.insert(tenants).values({ id, slug: `ws-${id}`, createdAt: new Date(), contentVersion }).run();

    it('replaces the empty-start stamp so later releases are delivered again', async () => {
        await addTenant(TENANT, NO_STARTER_CONTENT);
        expect((await install(TENANT)).status).toBe(200);
        expect(stamp(TENANT)).toBe(STARTER_CONTENT_VERSION);
    });

    it('leaves another workspace on the sentinel alone', async () => {
        await addTenant(TENANT, NO_STARTER_CONTENT);
        await addTenant(OTHER, NO_STARTER_CONTENT);
        await install(TENANT);
        expect(stamp(OTHER)).toBe(NO_STARTER_CONTENT);
    });

    it('does not touch a stamp that is an ordinary release value or null', async () => {
        await addTenant(TENANT, 'c0-older');
        await addTenant(OTHER, null);
        await install(TENANT);
        await install(OTHER);
        expect(stamp(TENANT)).toBe('c0-older');
        expect(stamp(OTHER)).toBeNull();
    });
});
