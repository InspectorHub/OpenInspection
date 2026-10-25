/**
 * GET /api/inspections/{id} returns the id of the inspection's primary report.
 *
 * A native device writes it into an exported package's manifest, and the importer compares it with the
 * primary report the server resolves for the same inspection. These specs drive the REAL app with a
 * native Bearer token. Every refusal has a positive control on the same harness.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { app } from '../../../server/index';
import { makeExecutionContext } from '../helpers/exec-ctx';
import * as schema from '../../../server/lib/db/schema';
import { createPrimaryReport, resolvePrimaryReportId } from '../../../server/lib/inspection/reports';
import { NATIVE_SCOPE, type NativeProps } from '../../../server/lib/auth/native-token';
import { createHarness, INSPECTOR_ID, OWNER_ID, TENANT_ID, type Harness } from '../helpers/tenant-email-harness';

const OTHER_INSPECTOR_ID = '22222222-0000-4000-8000-000000000003';
const OTHER_TENANT_ID = '11111111-0000-4000-8000-000000000002';
const OTHER_TENANT_INSPECTOR_ID = '22222222-0000-4000-8000-000000000004';
const WITH_REPORT = 'insp-prid-with-report';
const NO_REPORT = 'insp-prid-no-report';
const ANCILLARY_ONLY = 'insp-prid-ancillary-only';
const OTHER_TENANT_INSPECTION = 'insp-prid-other-tenant';

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

describe('GET /api/inspections/{id} primaryReportId (real app)', () => {
  let h: Harness | undefined;
  let primaryId = '';
  afterEach(() => { h?.close(); h = undefined; });

  async function setup() {
    h = await createHarness('standalone');
    const now = new Date();
    await h.db.insert(schema.users).values({
      id: OTHER_INSPECTOR_ID, tenantId: TENANT_ID, email: 'ines@harbor-light.test', passwordHash: 'h',
      role: 'inspector', name: 'Ines Inspector', createdAt: now,
    });
    // Both inspectors see only what is assigned to them.
    for (const userId of [INSPECTOR_ID, OTHER_INSPECTOR_ID]) {
      await h.db.update(schema.users).set({ permissionOverrides: { viewAllInspections: false } }).where(eq(schema.users.id, userId));
    }
    await h.db.insert(schema.tenants).values({
      id: OTHER_TENANT_ID, slug: 'other-prid', status: 'active', tier: 'free', maxUsers: 5,
      deploymentMode: 'shared', createdAt: now,
    });
    await h.db.insert(schema.users).values({
      id: OTHER_TENANT_INSPECTOR_ID, tenantId: OTHER_TENANT_ID, email: 'oscar@other.test', passwordHash: 'h',
      role: 'inspector', name: 'Oscar', createdAt: now,
    });
    for (const [id, tenantId, inspectorId] of [
      [WITH_REPORT, TENANT_ID, INSPECTOR_ID], [NO_REPORT, TENANT_ID, INSPECTOR_ID],
      [ANCILLARY_ONLY, TENANT_ID, INSPECTOR_ID], [OTHER_TENANT_INSPECTION, OTHER_TENANT_ID, OTHER_TENANT_INSPECTOR_ID],
    ] as const) {
      await h.db.insert(schema.inspections).values({
        id, tenantId, inspectorId, propertyAddress: '1 Main', date: '2026-06-01',
        status: 'confirmed', paymentStatus: 'paid', price: 0, createdAt: now,
      });
      await h.db.insert(schema.inspectionInspectors).values({ inspectionId: id, userId: inspectorId, tenantId, role: 'lead', createdAt: now });
    }
    primaryId = (await createPrimaryReport(h.db, TENANT_ID, WITH_REPORT, null)) ?? '';
    await createPrimaryReport(h.db, OTHER_TENANT_ID, OTHER_TENANT_INSPECTION, null);
    await h.db.insert(schema.reports).values({
      id: 'r-prid-ancillary', tenantId: TENANT_ID, inspectionId: ANCILLARY_ONLY, kind: 'ancillary',
      title: 'Radon', status: 'in_progress', createdAt: now,
    } as never);
    await h.db.insert(schema.reports).values({
      id: 'r-prid-ancillary-2', tenantId: TENANT_ID, inspectionId: WITH_REPORT, kind: 'ancillary',
      title: 'Sewer', status: 'in_progress', createdAt: new Date(now.getTime() - 60_000),
    } as never);
    const env = { ...h.env, NATIVE_CLIENT_ENABLED: 'true', OAUTH_PROVIDER: provider } as unknown as typeof h.env;
    async function get(id: string, token = 'insp:g:s'): Promise<Response> {
      const exec = makeExecutionContext({ label: 'primary-report-id' });
      const res = await app.request(`/api/inspections/${id}`, { headers: { Authorization: `Bearer ${token}` } }, env, exec.ctx);
      await exec.settle();
      return res;
    }
    return { get };
  }

  async function data(res: Response): Promise<Record<string, unknown>> {
    expect(res.status, await res.clone().text()).toBe(200);
    return ((await res.json()) as { data: Record<string, unknown> }).data;
  }

  it('returns the id of the primary report', async () => {
    const t = await setup();
    expect(primaryId).not.toBe('');
    expect((await data(await t.get(WITH_REPORT))).primaryReportId).toBe(primaryId);
  });

  it('returns the primary report, not another report of the same inspection', async () => {
    const t = await setup();
    const got = (await data(await t.get(WITH_REPORT))).primaryReportId;
    expect(got).not.toBe('r-prid-ancillary-2');
    expect(got).toBe(primaryId);
  });

  it('returns the key with a null value when the inspection has no primary report, even if it has an ancillary one', async () => {
    const t = await setup();
    for (const id of [NO_REPORT, ANCILLARY_ONLY]) {
      const d = await data(await t.get(id));
      expect(d, id).toHaveProperty('primaryReportId');
      expect(d.primaryReportId, id).toBeNull();
    }
    // Control: an inspection that has one reports a string.
    expect(typeof (await data(await t.get(WITH_REPORT))).primaryReportId).toBe('string');
  });

  it('is the same value the collab importer resolves for the inspection', async () => {
    const t = await setup();
    const fromApi = (await data(await t.get(WITH_REPORT))).primaryReportId;
    const resolved = await resolvePrimaryReportId(h!.db as never, TENANT_ID, WITH_REPORT);
    expect(fromApi).toBe(resolved);
    expect(resolved).toBe(primaryId);
  });

  it('keeps the rest of the response (inspection and template) alongside the new key', async () => {
    const t = await setup();
    const d = await data(await t.get(WITH_REPORT));
    expect((d.inspection as { id: string }).id).toBe(WITH_REPORT);
    expect(d).toHaveProperty('template');
  });

  it('answers 404 for another company\'s inspection and does not echo its report id', async () => {
    const t = await setup();
    const res = await t.get(OTHER_TENANT_INSPECTION);
    expect(res.status).toBe(404);
    const other = await resolvePrimaryReportId(h!.db as never, OTHER_TENANT_ID, OTHER_TENANT_INSPECTION);
    expect(other).not.toBeNull();
    expect(await res.text()).not.toContain(other as string);
    // Control: the owner reads an inspection of their own company.
    expect((await data(await t.get(WITH_REPORT, 'owner:g:s'))).primaryReportId).toBe(primaryId);
  });

  it('answers 404 to a restricted member for an inspection not assigned to them', async () => {
    const t = await setup();
    const res = await t.get(WITH_REPORT, 'other:g:s');
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain(primaryId);
    // Control: the assigned inspector gets 200 and the id.
    expect((await data(await t.get(WITH_REPORT, 'insp:g:s'))).primaryReportId).toBe(primaryId);
  });
});
