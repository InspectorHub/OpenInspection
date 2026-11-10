/**
 * Creating an inspection copies the template document into the inspection's own snapshot.
 *
 * Template rows written by older code hold the document wrapped in a JSON string literal; the copy has to
 * unwrap it so the new snapshot is stored as a document. A value that cannot be read at all is carried
 * across unchanged rather than replaced by null, so a bad row stays visible instead of silently vanishing.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Database as SqliteDatabase } from 'better-sqlite3';
import { InspectionCoreService } from '../../../server/services/inspection/inspection-core.service';
import { ScopedDB } from '../../../server/lib/db/scoped';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import { createTestDb, setupSchema } from '../db';
import { asD1Db } from '../helpers/test-db';
import { lazyD1 } from '../helpers/d1-binding';
import * as schema from '../../../server/lib/db/schema';

const testD1 = lazyD1();
const T1 = 't1';
const DOC = { schemaVersion: 2, sections: [{ id: 's1', title: 'Roof', items: [] }] };
const BASE = { propertyAddress: '123 Main St', addressZip: '90210', date: '2026-06-22', clientName: 'Jane Buyer', clientEmail: 'jane@example.com' };

describe('inspection create: template copy', () => {
    let sqlite: SqliteDatabase;
    let svc: InspectionCoreService;

    beforeEach(async () => {
        const fixture = createTestDb();
        sqlite = fixture.sqlite;
        await setupSchema(sqlite);
        testD1.use(fixture.db);
        await fixture.db.insert(schema.tenants).values({
            id: T1, slug: 't1', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await seedRoleProfiles(asD1Db(fixture.db), T1, new Date(1));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        svc = new InspectionCoreService(testD1.binding, undefined, new ScopedDB(fixture.db as any, T1));
    });

    const addTemplate = (id: string, storedText: string) =>
        sqlite.prepare('INSERT INTO templates (id, tenant_id, name, version, schema, created_at) VALUES (?,?,?,?,?,?)')
            .run(id, T1, id, 1, storedText, Date.now());
    const snapshotOf = (inspectionId: string) =>
        sqlite.prepare('SELECT template_snapshot AS s, json_type(template_snapshot) AS t FROM inspections WHERE id = ?')
            .get(inspectionId) as { s: string; t: string };

    it('unwraps a template row an older writer double-encoded', async () => {
        addTemplate('wrapped', JSON.stringify(JSON.stringify(DOC)));
        const created = await svc.createInspection(T1, { ...BASE, templateId: 'wrapped' });
        const row = snapshotOf(created.id);
        expect(row.t).toBe('object');
        expect(JSON.parse(row.s)).toStrictEqual(DOC);
    });

    it('control: an object template row is copied as the same document', async () => {
        addTemplate('plain', JSON.stringify(DOC));
        const created = await svc.createInspection(T1, { ...BASE, templateId: 'plain' });
        const row = snapshotOf(created.id);
        expect(row.t).toBe('object');
        expect(JSON.parse(row.s)).toStrictEqual(DOC);
    });

    it('copies an unreadable value unchanged instead of storing null', async () => {
        // A string literal whose content is not JSON: it reads back as the text, which no layer can unwrap.
        addTemplate('unreadable', JSON.stringify('not a document'));
        const created = await svc.createInspection(T1, { ...BASE, templateId: 'unreadable' });
        const row = snapshotOf(created.id);
        expect(row.s).not.toBeNull();
        expect(JSON.parse(row.s)).toBe('not a document');
    });
});
