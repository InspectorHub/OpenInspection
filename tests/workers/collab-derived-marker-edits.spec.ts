/**
 * What clears the `derived-from-d1` marker, what keeps it across a hibernation, and what a pending save does to a replacement
 * (workerd). Companion to collab-derived-marker.spec.ts, which covers the client edit and the replacement itself.
 *
 * Every refusal or clearing is paired with a case that leaves the marker alone, so a marker that never clears (or never sets)
 * cannot pass.
 */

import { env, runInDurableObject, runDurableObjectAlarm } from 'cloudflare:test';
import { INSPECTION_RESULTS_TEST_DDL } from '../helpers/inline-ddl';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { InspectionDocDO } from '../../server/durable-objects/inspection-doc';
import { bytesToBase64, type StateExport } from '../../server/durable-objects/inspection-doc-state-transfer';

interface TestBindings {
    DB: D1Database;
    INSPECTION_DOC: DurableObjectNamespace<InspectionDocDO>;
}
const b = env as typeof env & TestBindings;

const TENANT = 't-marker-edits';
const COMPOSITE = '_default:s1:roof';
const BLOB = { [COMPOSITE]: { rating: 'D', notes: 'Flashing lifted', original: { rating: 'D', notes: 'before' } } };

async function seed(blob: object): Promise<{ name: string; headers: Record<string, string>; reportId: string; inspectionId: string }> {
    await b.DB.exec(INSPECTION_RESULTS_TEST_DDL);
    await b.DB.exec('CREATE TABLE IF NOT EXISTS inspections (id TEXT PRIMARY KEY NOT NULL, tenant_id TEXT NOT NULL, template_id TEXT, template_snapshot TEXT);');
    const suffix = crypto.randomUUID().slice(0, 8);
    const inspectionId = `insp-${suffix}`;
    const reportId = `rpt-${suffix}`;
    await b.DB.prepare('INSERT INTO inspections (id, tenant_id, template_snapshot) VALUES (?, ?, ?)')
        .bind(inspectionId, TENANT, JSON.stringify({ sections: [{ id: 's1', items: [{ id: 'roof' }] }] })).run();
    await b.DB.prepare('INSERT INTO inspection_results (id, tenant_id, inspection_id, report_id, data, last_synced_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(crypto.randomUUID(), TENANT, inspectionId, reportId, JSON.stringify(blob), Date.now()).run();
    return {
        name: `${TENANT}:${reportId}`, inspectionId, reportId,
        headers: { 'x-tenant-id': TENANT, 'x-inspection-id': inspectionId, 'x-report-id': reportId, 'content-type': 'application/json' },
    };
}

const stub = (name: string) => b.INSPECTION_DOC.get(b.INSPECTION_DOC.idFromName(name));
const marker = async (name: string) => ((await (await stub(name).fetch('https://do.test/state-export')).json()) as StateExport).derivedFromD1;
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 1300));

describe('which server-side changes count as an edit', () => {
    beforeAll(() => b.DB.exec(INSPECTION_RESULTS_TEST_DDL));
    beforeEach(() => b.DB.exec('DELETE FROM inspection_results;'));

    it('a follow-up answer written into the document clears the marker; a follow-up that finds nothing to write does not', async () => {
        const f = await seed(BLOB);
        const nothing = await stub(f.name).fetch('https://do.test/followup', { method: 'POST', headers: f.headers, body: JSON.stringify({ itemId: 'not-carried' }) });
        expect(nothing.status).toBe(404);
        await runDurableObjectAlarm(stub(f.name));
        expect(await marker(f.name)).toBe(true);

        const written = await stub(f.name).fetch('https://do.test/followup', { method: 'POST', headers: f.headers, body: JSON.stringify({ itemId: 'roof', status: 'resolved' }) });
        expect(written.status).toBe(200);
        expect(await marker(f.name)).toBe(false);
    });

    it('a legacy-key rename clears the marker; a rename with nothing to rename does not', async () => {
        const untouched = await seed({ [COMPOSITE]: { rating: 'D', notes: 'already composite' } });
        const none = await stub(untouched.name).fetch('https://do.test/rename-legacy-keys', { method: 'POST', headers: untouched.headers });
        expect(await none.json()).toMatchObject({ renamed: 0 });
        await runDurableObjectAlarm(stub(untouched.name));
        expect(await marker(untouched.name)).toBe(true);

        const legacy = await seed({ roof: { rating: 'D', notes: 'bare key' } });
        const renamed = await stub(legacy.name).fetch('https://do.test/rename-legacy-keys', { method: 'POST', headers: legacy.headers });
        expect(await renamed.json()).toMatchObject({ renamed: 1 });
        expect(await marker(legacy.name)).toBe(false);
    });
});

describe('the marker across a hibernation', () => {
    beforeAll(() => b.DB.exec(INSPECTION_RESULTS_TEST_DDL));
    beforeEach(() => b.DB.exec('DELETE FROM inspection_results;'));

    /** What a rebuilt object does first: read the marker back from storage. The private field is reset to what a fresh instance starts with. */
    async function reconstruct(name: string): Promise<boolean> {
        return runInDurableObject(stub(name), async (instance) => {
            Reflect.set(instance, 'derivedFromD1', false);
            await Reflect.apply(Reflect.get(instance, 'hydrate'), instance, []);
            return Reflect.get(instance, 'derivedFromD1') === true;
        });
    }

    it('is read back from storage when the object is rebuilt, and a stored false stays false', async () => {
        const f = await seed(BLOB);
        await stub(f.name).fetch('https://do.test/followup', { method: 'POST', headers: f.headers, body: JSON.stringify({ itemId: 'not-carried' }) });
        await runDurableObjectAlarm(stub(f.name));
        expect(await reconstruct(f.name)).toBe(true);

        await stub(f.name).fetch('https://do.test/followup', { method: 'POST', headers: f.headers, body: JSON.stringify({ itemId: 'roof', status: 'resolved' }) });
        expect(await reconstruct(f.name)).toBe(false);
    });
});

describe('a replacement while a save is still pending', () => {
    beforeAll(() => b.DB.exec(INSPECTION_RESULTS_TEST_DDL));
    beforeEach(() => b.DB.exec('DELETE FROM inspection_results;'));

    it('is refused as live until the pending save has run, and goes through afterwards', async () => {
        const f = await seed(BLOB);
        await stub(f.name).fetch('https://do.test/followup', { method: 'POST', headers: f.headers, body: JSON.stringify({ itemId: 'not-carried' }) });
        await runDurableObjectAlarm(stub(f.name));

        const source = new Y.Doc();
        source.getMap('results').set('marker', 'old history');
        const payload = JSON.stringify({
            ydoc: bytesToBase64(Y.encodeStateAsUpdate(source)),
            identity: { tenantId: TENANT, inspectionId: f.inspectionId, reportId: f.reportId },
            replaceDerived: true,
        });
        const during = await stub(f.name).fetch('https://do.test/state-import', { method: 'POST', body: payload });
        expect(during.status).toBe(409);
        expect(await during.json()).toMatchObject({ reason: 'target-live' });

        await settle();
        const after = await stub(f.name).fetch('https://do.test/state-import', { method: 'POST', body: payload });
        expect(after.status).toBe(200);
    });
});
