/**
 * Company permission templates (`permission_templates`): create, rename, the
 * per-company limit, tenant isolation, the capability whitelist, the grant ceiling
 * applied to a template's content, and archiving. Against the real migrations.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { PermissionTemplateService } from '../../../server/services/team/permission-templates.service';
import { MAX_COMPANY_TEMPLATES } from '../../../server/lib/auth/permission-templates';
import { getCapabilities } from '../../../server/lib/auth/capabilities';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '11111111-1111-1111-1111-1111111111a1';
const OTHER = '11111111-1111-1111-1111-1111111111b2';
const OWNER = { role: 'owner', capabilities: getCapabilities('owner', null) } as const;
// A manager whose company finance switch is off: cannot hand it to a template.
const MANAGER_NO_FINANCE = { role: 'manager', capabilities: getCapabilities('manager', { companyFinance: false }) } as const;

describe('PermissionTemplateService', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let svc: PermissionTemplateService;

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        await setupSchema(fix.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(db);
        svc = new PermissionTemplateService({} as D1Database);
    });

    it('creates a template and lists it for its own company only', async () => {
        const t = await svc.create(TENANT, OWNER, { name: 'Field trainee', baseRole: 'inspector', overrides: { publish: false } }, 'u1');
        expect(t).toMatchObject({ name: 'Field trainee', baseRole: 'inspector', overrides: { publish: false } });
        expect((await svc.list(TENANT)).map((x) => x.id)).toEqual([t.id]);
        expect(await svc.list(OTHER)).toEqual([]);
    });

    it('another company cannot read, rename, archive or apply it', async () => {
        const t = await svc.create(TENANT, OWNER, { name: 'Mine', baseRole: 'inspector' }, null);
        await expect(svc.get(OTHER, t.id)).rejects.toMatchObject({ status: 404 });
        await expect(svc.update(OTHER, OWNER, t.id, { name: 'Theirs', baseRole: 'inspector' })).rejects.toMatchObject({ status: 404 });
        await expect(svc.archive(OTHER, t.id)).rejects.toMatchObject({ status: 404 });
        await expect(svc.resolveRef(OTHER, t.id)).rejects.toMatchObject({ status: 404 });
    });

    it('refuses a duplicate name among live templates, and allows the name again once archived', async () => {
        const t = await svc.create(TENANT, OWNER, { name: 'Lead', baseRole: 'inspector' }, null);
        await expect(svc.create(TENANT, OWNER, { name: '  Lead ', baseRole: 'staff' }, null)).rejects.toMatchObject({ status: 409 });
        // The same name in another company is fine.
        await svc.create(OTHER, OWNER, { name: 'Lead', baseRole: 'inspector' }, null);
        await svc.archive(TENANT, t.id);
        await expect(svc.create(TENANT, OWNER, { name: 'Lead', baseRole: 'staff' }, null)).resolves.toMatchObject({ name: 'Lead' });
    });

    it('stops at the per-company limit, and archived templates do not count', async () => {
        for (let i = 0; i < MAX_COMPANY_TEMPLATES; i++) {
            await svc.create(TENANT, OWNER, { name: `T${i}`, baseRole: 'inspector' }, null);
        }
        await expect(svc.create(TENANT, OWNER, { name: 'One too many', baseRole: 'inspector' }, null)).rejects.toMatchObject({ status: 409 });
        const first = (await svc.list(TENANT))[0]!;
        await svc.archive(TENANT, first.id);
        await expect(svc.create(TENANT, OWNER, { name: 'One too many', baseRole: 'inspector' }, null)).resolves.toBeTruthy();
    });

    it('keeps only known capability keys and drops what restates the role default', async () => {
        const t = await svc.create(TENANT, OWNER, {
            name: 'Odd', baseRole: 'inspector',
            overrides: { publish: false, scheduleOthers: false, notACapability: true } as never,
        }, null);
        expect(t.overrides).toEqual({ publish: false });
        const row = await db.select().from(schema.permissionTemplates).where(eq(schema.permissionTemplates.id, t.id)).get();
        expect(row?.overrides).toEqual({ publish: false });
    });

    it('is never based on owner or agent', async () => {
        await expect(svc.create(TENANT, OWNER, { name: 'Boss', baseRole: 'owner' as never }, null)).rejects.toMatchObject({ status: 400 });
        await expect(svc.create(TENANT, OWNER, { name: 'Ag', baseRole: 'agent' as never }, null)).rejects.toMatchObject({ status: 400 });
    });

    it('a manager cannot save a template that switches on what the manager lacks, but can switch things off', async () => {
        await expect(svc.create(TENANT, MANAGER_NO_FINANCE, { name: 'Money', baseRole: 'staff', overrides: { companyFinance: true } }, null))
            .rejects.toMatchObject({ status: 403 });
        // A manager-based template carries company finance through the role itself.
        await expect(svc.create(TENANT, MANAGER_NO_FINANCE, { name: 'Mgr', baseRole: 'manager' }, null)).rejects.toMatchObject({ status: 403 });
        await expect(svc.create(TENANT, MANAGER_NO_FINANCE, { name: 'Trainee', baseRole: 'inspector', overrides: { publish: false } }, null))
            .resolves.toBeTruthy();
        // And the same content is fine for an owner.
        await expect(svc.create(TENANT, OWNER, { name: 'Money', baseRole: 'staff', overrides: { companyFinance: true } }, null)).resolves.toBeTruthy();
    });

    it('a manager cannot widen an existing template past their own permissions either', async () => {
        const t = await svc.create(TENANT, OWNER, { name: 'Office', baseRole: 'staff' }, null);
        await expect(svc.update(TENANT, MANAGER_NO_FINANCE, t.id, { name: 'Office', baseRole: 'staff', overrides: { companyFinance: true } }))
            .rejects.toMatchObject({ status: 403 });
        expect((await svc.get(TENANT, t.id)).overrides).toBeNull();
    });

    it('rename and rebase update in place', async () => {
        const t = await svc.create(TENANT, OWNER, { name: 'A', baseRole: 'inspector' }, null);
        const u = await svc.update(TENANT, OWNER, t.id, { name: 'B', baseRole: 'staff', overrides: { companyFinance: true } });
        expect(u).toMatchObject({ id: t.id, name: 'B', baseRole: 'staff', overrides: { companyFinance: true } });
        expect(await svc.list(TENANT)).toHaveLength(1);
    });

    it('resolveRef accepts a system key and a company id, and rejects anything else', async () => {
        const sys = await svc.resolveRef(TENANT, 'inspector_trainee');
        expect(sys).toMatchObject({ role: 'inspector', system: true, ref: 'inspector_trainee' });
        const t = await svc.create(TENANT, OWNER, { name: 'Mine', baseRole: 'staff', overrides: { companyFinance: true } }, null);
        expect(await svc.resolveRef(TENANT, t.id)).toMatchObject({ role: 'staff', permissionOverrides: { companyFinance: true }, system: false, name: 'Mine' });
        await expect(svc.resolveRef(TENANT, 'no-such')).rejects.toMatchObject({ status: 404 });
    });

    it('an archived template is gone for new applications', async () => {
        const t = await svc.create(TENANT, OWNER, { name: 'Gone', baseRole: 'staff' }, null);
        await svc.archive(TENANT, t.id);
        await expect(svc.resolveRef(TENANT, t.id)).rejects.toMatchObject({ status: 404 });
        expect(await svc.list(TENANT)).toEqual([]);
    });

    it('a missing table lists nothing instead of failing the page', async () => {
        const fix = createTestDb(); // no migrations applied
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(fix.db);
        expect(await svc.list(TENANT)).toEqual([]);
    });
});
