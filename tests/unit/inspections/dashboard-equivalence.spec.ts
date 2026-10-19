/**
 * GET /api/inspections/dashboard answers byte-for-byte what it answered before
 * the reads were reorganised for fewer round trips.
 *
 * The files under `__goldens__/` were written by the code that ran the dashboard's
 * reads one after another; they are the reference, not an assertion about what
 * the response ought to be. They are compared as text with the key order kept,
 * so a re-ordered field or a changed value fails here, not in the browser.
 *
 * Fixtures: an empty company; a company with every bucket, every decoration and
 * more than 50 later inspections; the same company read as owner, manager and
 * as an inspector whose access is limited to the inspections assigned to them
 * (money redacted, fewer rows); and the same company next to a second one whose
 * rows name this company's inspection ids. The last must read exactly like the
 * company alone, and nothing of the other company may appear in it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../../server/index';
import { makeExecutionContext } from '../helpers/exec-ctx';
import { buildKeyring, signJwt } from '../../../server/lib/jwt-keyring';
import { createHarness, TENANT_ID, OWNER_ID, INSPECTOR_ID, type Harness } from '../helpers/tenant-email-harness';
import { FIXED_NOW, MANAGER_ID, OTHER_TENANT_ID, seedDashboard } from '../helpers/dashboard-fixture';

async function dashboardText(h: Harness, sub: string, role: string): Promise<string> {
    const keyring = await buildKeyring(h.env as unknown as Record<string, string | undefined>);
    const iat = Math.floor(Date.now() / 1000);
    const token = await signJwt({ sub, 'custom:tenantId': TENANT_ID, 'custom:userRole': role, iat, exp: iat + 3600 }, keyring);
    const exec = makeExecutionContext({ label: 'dashboard' });
    const res = await app.request('/api/inspections/dashboard', { headers: { authorization: `Bearer ${token}` } }, h.env, exec.ctx);
    await exec.settle();
    expect(res.status).toBe(200);
    // Pretty-printed with the key order the response had.
    return `${JSON.stringify(JSON.parse(await res.text()), null, 1)}\n`;
}

const golden = (name: string) => `./__goldens__/dashboard-${name}.json`;

describe('dashboard response is unchanged by the read restructuring', () => {
    let h: Harness;
    beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(FIXED_NOW); });
    afterEach(() => { h?.close(); vi.useRealTimers(); });

    it('an empty company', async () => {
        h = await createHarness('standalone');
        await expect(await dashboardText(h, OWNER_ID, 'owner')).toMatchFileSnapshot(golden('empty'));
    });

    it('a full company, read as the owner', async () => {
        h = await createHarness('standalone');
        await seedDashboard(h);
        await expect(await dashboardText(h, OWNER_ID, 'owner')).toMatchFileSnapshot(golden('owner'));
    });

    it('a full company, read as a manager', async () => {
        h = await createHarness('standalone');
        await seedDashboard(h);
        await expect(await dashboardText(h, MANAGER_ID, 'manager')).toMatchFileSnapshot(golden('manager'));
    });

    it('a full company, read as an inspector limited to their own inspections', async () => {
        h = await createHarness('standalone');
        await seedDashboard(h);
        await expect(await dashboardText(h, INSPECTOR_ID, 'inspector')).toMatchFileSnapshot(golden('inspector'));
    });

    it('another company next to it changes nothing and shows up nowhere (negative control)', async () => {
        h = await createHarness('standalone');
        await seedDashboard(h, { withOtherCompany: true });
        const text = await dashboardText(h, OWNER_ID, 'owner');
        // Same bytes as the company on its own.
        await expect(text).toMatchFileSnapshot(golden('owner'));
        // The control must be able to see what it guards against.
        expect(text).not.toContain(OTHER_TENANT_ID);
        expect(text).not.toContain('Foreign');
        expect(text).not.toContain('c-other');
    });

    it('the fixture reaches every part of the response (the instrument is alive)', async () => {
        h = await createHarness('standalone');
        await seedDashboard(h);
        const body = JSON.parse(await dashboardText(h, OWNER_ID, 'owner')) as {
            data: Record<string, unknown[] | number | Record<string, unknown>> & { laterTotal: number; conciergePending: number };
        };
        const d = body.data;
        for (const bucket of ['needsAttention', 'today', 'thisWeek', 'later', 'recentReports', 'cancelled']) {
            expect((d[bucket] as unknown[]).length, bucket).toBeGreaterThan(0);
        }
        expect((d.later as unknown[]).length).toBe(50);
        expect(d.laterTotal).toBe(55);
        expect(d.conciergePending).toBe(2);
        const rows = [...(d.today as Array<Record<string, unknown>>), ...(d.later as Array<Record<string, unknown>>), ...(d.recentReports as Array<Record<string, unknown>>)];
        expect(rows.some((r) => r.agentName === 'Lisa Listing')).toBe(true);
        expect(rows.some((r) => r.agentName === 'Bob Buyer')).toBe(true);
        expect(rows.some((r) => r.inspectorName === 'Ivan Inspector')).toBe(true);
        expect(rows.some((r) => typeof r.siblingCount === 'number')).toBe(true);
        expect(rows.some((r) => (r.defectStats as { safety: number }).safety > 0)).toBe(true);
    });
});
