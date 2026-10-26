/**
 * GET /api/inspections/{id} reports `revisionStatus` and `templateSnapshot`.
 *
 * The statutory revision judgement is `revisionStatusForInspection`; the route only forwards it, from the
 * snapshot and date it has already loaded. These specs drive the REAL app with a native Bearer token. Every
 * refusal has a positive control on the same harness, and the key is asserted ABSENT (not null) when there is
 * nothing to say.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from '../../../server/index';
import { makeExecutionContext } from '../helpers/exec-ctx';
import * as schema from '../../../server/lib/db/schema';
import { NATIVE_SCOPE, type NativeProps } from '../../../server/lib/auth/native-token';
import { revisionStatusForInspection } from '../../../server/lib/statutory/revision-status';
import { SERVER_CONTRACT_VERSION } from '../../../server/lib/native/client-version';
import { createHarness, INSPECTOR_ID, OWNER_ID, TENANT_ID, type Harness } from '../helpers/tenant-email-harness';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = resolve(__dirname, '../../../contracts/native-contract.openapi.json');

const OTHER_INSPECTOR_ID = '22222222-0000-4000-8000-000000000003';
const OTHER_TENANT_ID = '11111111-0000-4000-8000-000000000002';
const OTHER_TENANT_INSPECTOR_ID = '22222222-0000-4000-8000-000000000004';
const STATUTORY = 'insp-rev-statutory';
const ORDINARY = 'insp-rev-ordinary';
const NO_REVISION = 'insp-rev-no-revision';
const OTHER_TENANT_INSPECTION = 'insp-rev-other-tenant';
// Inside the window of the only published TX revision, long after its mandate.
const DATE = '2024-05-01';

const statutorySnapshot = (revision: string | null) => ({
  schemaVersion: 2,
  sections: [],
  statutoryForm: { formId: 'tx_trec_rei', bindings: {}, ...(revision === null ? {} : { revision }) },
});
const ORDINARY_SNAPSHOT = { schemaVersion: 2, sections: [] };

function propsFor(userId: string, tenantId: string, role: NativeProps['role']): NativeProps {
  return { kind: 'native', userId, tenantId, role, lastUsedAt: 0, grantedAt: 0 };
}
const PROPS: Record<string, NativeProps> = {
  'owner:g:s': propsFor(OWNER_ID, TENANT_ID, 'owner'),
  'insp:g:s': propsFor(INSPECTOR_ID, TENANT_ID, 'inspector'),
  'other:g:s': propsFor(OTHER_INSPECTOR_ID, TENANT_ID, 'inspector'),
};
const provider = {
  unwrapToken: async (t: string) => {
    const props = PROPS[t];
    return props ? { scope: [NATIVE_SCOPE], grant: { clientId: 'c', scope: [NATIVE_SCOPE], props } } : null;
  },
};

describe('GET /api/inspections/{id} revisionStatus (real app)', () => {
  let h: Harness | undefined;
  afterEach(() => { h?.close(); h = undefined; });

  async function setup() {
    h = await createHarness('standalone');
    const harness = h;
    const now = new Date();
    await harness.db.insert(schema.users).values({
      id: OTHER_INSPECTOR_ID, tenantId: TENANT_ID, email: 'ines@harbor-light.test', passwordHash: 'h',
      role: 'inspector', name: 'Ines Inspector', createdAt: now,
    });
    for (const userId of [INSPECTOR_ID, OTHER_INSPECTOR_ID]) {
      await harness.db.update(schema.users).set({ permissionOverrides: { viewAllInspections: false } }).where(eq(schema.users.id, userId));
    }
    await harness.db.insert(schema.tenants).values({
      id: OTHER_TENANT_ID, slug: 'other-rev', status: 'active', tier: 'free', maxUsers: 5,
      deploymentMode: 'shared', createdAt: now,
    });
    await harness.db.insert(schema.users).values({
      id: OTHER_TENANT_INSPECTOR_ID, tenantId: OTHER_TENANT_ID, email: 'oscar@other.test', passwordHash: 'h',
      role: 'inspector', name: 'Oscar', createdAt: now,
    });
    for (const [id, tenantId, inspectorId, snapshot] of [
      [STATUTORY, TENANT_ID, INSPECTOR_ID, statutorySnapshot('REI 7-6')],
      [ORDINARY, TENANT_ID, INSPECTOR_ID, ORDINARY_SNAPSHOT],
      [NO_REVISION, TENANT_ID, INSPECTOR_ID, statutorySnapshot(null)],
      [OTHER_TENANT_INSPECTION, OTHER_TENANT_ID, OTHER_TENANT_INSPECTOR_ID, statutorySnapshot('REI 7-6')],
    ] as const) {
      await harness.db.insert(schema.inspections).values({
        id, tenantId, inspectorId, propertyAddress: '1 Main', date: DATE, templateSnapshot: snapshot,
        status: 'confirmed', paymentStatus: 'paid', price: 0, createdAt: now,
      });
      await harness.db.insert(schema.inspectionInspectors).values({ inspectionId: id, userId: inspectorId, tenantId, role: 'lead', createdAt: now });
    }
    const queries = { count: 0 };
    const counted = new Proxy(harness.env.DB, {
      get(target, prop) {
        const value: unknown = Reflect.get(target, prop, target);
        if (prop === 'prepare' || prop === 'batch') {
          return (...args: unknown[]) => { queries.count += 1; return (value as (...a: unknown[]) => unknown).apply(target, args); };
        }
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const env = { ...harness.env, DB: counted, NATIVE_CLIENT_ENABLED: 'true', OAUTH_PROVIDER: provider } as unknown as typeof harness.env;
    async function get(id: string, token = 'insp:g:s'): Promise<Response> {
      const exec = makeExecutionContext({ label: 'revision-status' });
      const res = await app.request(`/api/inspections/${id}`, { headers: { Authorization: `Bearer ${token}` } }, env, exec.ctx);
      await exec.settle();
      return res;
    }
    async function patchSnapshot(id: string, snapshot: unknown, token = 'owner:g:s'): Promise<Response> {
      const exec = makeExecutionContext({ label: 'revision-status-patch' });
      const res = await app.request(`/api/inspections/${id}/template-snapshot`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ snapshot }),
      }, env, exec.ctx);
      await exec.settle();
      return res;
    }
    return { get, patchSnapshot, queries, db: harness.db };
  }

  async function data(res: Response): Promise<Record<string, unknown>> {
    expect(res.status, await res.clone().text()).toBe(200);
    return ((await res.json()) as { data: Record<string, unknown> }).data;
  }

  it('reports the revision status of an inspection whose template declares a statutory form', async () => {
    const t = await setup();
    expect((await data(await t.get(STATUTORY))).revisionStatus).toStrictEqual({ kind: 'current' });
  });

  it('reports a different status when the template revision is not the one the date calls for (not a constant)', async () => {
    const t = await setup();
    await t.db.update(schema.inspections).set({ templateSnapshot: statutorySnapshot('REI 7-5') }).where(eq(schema.inspections.id, STATUTORY));
    expect((await data(await t.get(STATUTORY))).revisionStatus).toStrictEqual({
      kind: 'cannot_produce', applicableVersion: 'REI 7-6', templateVersion: 'REI 7-5',
    });
  });

  it('omits the key, rather than sending null, when there is nothing to say', async () => {
    const t = await setup();
    for (const id of [ORDINARY, NO_REVISION]) {
      const d = await data(await t.get(id));
      expect(d, id).not.toHaveProperty('revisionStatus');
      expect(d, id).toHaveProperty('primaryReportId');
    }
    // Control, same harness: the statutory inspection does carry it.
    expect(await data(await t.get(STATUTORY))).toHaveProperty('revisionStatus');
  });

  it('gives the answer the shared judgement gives for the same snapshot and date', async () => {
    const t = await setup();
    const expected = revisionStatusForInspection({ snapshot: statutorySnapshot('REI 7-6'), inspectionDate: DATE, now: Date.now() });
    expect(expected).not.toBeNull();
    expect((await data(await t.get(STATUTORY))).revisionStatus).toStrictEqual(expected);
  });

  it('declares templateSnapshot on the inspection it returns', async () => {
    const t = await setup();
    const inspection = (await data(await t.get(STATUTORY))).inspection as Record<string, unknown>;
    expect(inspection.templateSnapshot).toStrictEqual(statutorySnapshot('REI 7-6'));
  });

  // The editor's own writes (`updateTemplateSnapshot`, `switchRatingSystem`) stringify the snapshot before
  // handing it to a JSON column, so such a row reads back as a JSON-encoded string.
  const encodeLikeTheEditor = (snapshot: unknown) => JSON.stringify(snapshot) as never;

  it('returns the snapshot as an object after the editor saved it through the template-snapshot route', async () => {
    const t = await setup();
    const edited = { schemaVersion: 2, sections: [{ id: 's1', title: 'Roof', items: [] }] };
    const saved = await t.patchSnapshot(ORDINARY, edited);
    expect(saved.status, await saved.clone().text()).toBe(200);
    const inspection = (await data(await t.get(ORDINARY))).inspection as Record<string, unknown>;
    expect(typeof inspection.templateSnapshot).toBe('object');
    expect((inspection.templateSnapshot as { sections: unknown[] }).sections).toHaveLength(1);
    // Control: a snapshot stored directly as an object reads back the same way.
    expect(((await data(await t.get(STATUTORY))).inspection as Record<string, unknown>).templateSnapshot).toStrictEqual(statutorySnapshot('REI 7-6'));
  });

  it('still computes the status for a statutory snapshot stored as an encoded string (the rating-system switch)', async () => {
    const t = await setup();
    await t.db.update(schema.inspections).set({ templateSnapshot: encodeLikeTheEditor(statutorySnapshot('REI 7-6')) }).where(eq(schema.inspections.id, STATUTORY));
    const d = await data(await t.get(STATUTORY));
    expect(d.revisionStatus).toStrictEqual({ kind: 'current' });
    expect((d.inspection as { templateSnapshot: unknown }).templateSnapshot).toStrictEqual(statutorySnapshot('REI 7-6'));
    // Control: the same string form of an ordinary snapshot still yields no status.
    await t.db.update(schema.inspections).set({ templateSnapshot: encodeLikeTheEditor(ORDINARY_SNAPSHOT) }).where(eq(schema.inspections.id, ORDINARY));
    const ordinary = await data(await t.get(ORDINARY));
    expect(ordinary).not.toHaveProperty('revisionStatus');
    expect((ordinary.inspection as { templateSnapshot: unknown }).templateSnapshot).toStrictEqual(ORDINARY_SNAPSHOT);
  });

  it('answers null, not an error, when the stored snapshot is not a readable object', async () => {
    const t = await setup();
    for (const bad of ['{not json', '"just a string"', '42']) {
      await t.db.update(schema.inspections).set({ templateSnapshot: bad as never }).where(eq(schema.inspections.id, NO_REVISION));
      const res = await t.get(NO_REVISION);
      expect(res.status, bad).toBe(200);
      const d = ((await res.json()) as { data: Record<string, unknown> }).data;
      expect((d.inspection as Record<string, unknown>).templateSnapshot, bad).toBeNull();
      expect(d, bad).not.toHaveProperty('revisionStatus');
    }
    // Control: the same inspection answers its snapshot again once a readable one is stored.
    await t.db.update(schema.inspections).set({ templateSnapshot: statutorySnapshot('REI 7-6') }).where(eq(schema.inspections.id, NO_REVISION));
    expect(await data(await t.get(NO_REVISION))).toHaveProperty('revisionStatus');
  });

  it('makes no database call for the status: an inspection that has one costs what one without costs', async () => {
    const t = await setup();
    // Each inspection is read once first: the first read of a row pays one-off costs that are not the status's.
    await data(await t.get(ORDINARY));
    await data(await t.get(STATUTORY));
    t.queries.count = 0;
    await data(await t.get(ORDINARY));
    const withoutStatus = t.queries.count;
    t.queries.count = 0;
    await data(await t.get(STATUTORY));
    const withStatus = t.queries.count;
    // Control: the counter sees the route's own reads, so a zero would mean a broken counter.
    expect(withoutStatus).toBeGreaterThan(0);
    expect(withStatus).toBe(withoutStatus);
  });

  it('answers 404 for another company\'s inspection and does not echo its status', async () => {
    const t = await setup();
    const res = await t.get(OTHER_TENANT_INSPECTION);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('revisionStatus');
    // Control: the owner reads their own company's statutory inspection.
    expect(await data(await t.get(STATUTORY, 'owner:g:s'))).toHaveProperty('revisionStatus');
  });

  it('answers 404 to a restricted member for an inspection not assigned to them', async () => {
    const t = await setup();
    const res = await t.get(STATUTORY, 'other:g:s');
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('revisionStatus');
    // Control: the assigned inspector gets it.
    expect(await data(await t.get(STATUTORY, 'insp:g:s'))).toHaveProperty('revisionStatus');
  });
});

describe('the committed contract for GET /api/inspections/{id}', () => {
  interface Schema { properties?: Record<string, Schema>; required?: string[]; oneOf?: unknown[]; allOf?: Schema[] }
  const contract = JSON.parse(readFileSync(CONTRACT_PATH, 'utf-8')) as {
    paths: Record<string, Record<string, { responses: Record<string, { content: { 'application/json': { schema: Schema } } }> }>>;
  };
  const body = contract.paths['/api/inspections/{id}']?.['get']?.responses['200']?.content['application/json'].schema;
  const dataSchema = body?.properties?.['data'];

  it('declares revisionStatus as an optional typed property', () => {
    expect(dataSchema?.properties).toHaveProperty('revisionStatus');
    expect(dataSchema?.required ?? []).not.toContain('revisionStatus');
    expect(JSON.stringify(dataSchema?.properties?.['revisionStatus'])).toContain('cannot_produce');
    // Control: a property the route always sends is required.
    expect(dataSchema?.required ?? []).toContain('primaryReportId');
  });

  it('declares templateSnapshot as optional on the inspection, beside the shared Inspection component', () => {
    const parts = dataSchema?.properties?.['inspection']?.allOf ?? [];
    const extension = parts.find((p) => p.properties !== undefined);
    expect(extension?.properties).toHaveProperty('templateSnapshot');
    expect(extension?.required ?? []).not.toContain('templateSnapshot');
    // Control: the shared component is still referenced, so list responses are untouched.
    expect(JSON.stringify(parts)).toContain('#/components/schemas/Inspection');
  });

  it('leaves the contract version where it was (the key is detected by its presence)', () => {
    expect(SERVER_CONTRACT_VERSION).toBe(2);
  });
});
