/**
 * Design System 0520 subsystem E — publish pre-flight, list workflow, exports,
 * integrations, metrics, report credit.
 *
 * RUN MODE: `SEED_E2E=1 npx playwright test --project=subsystem-e-flows`.
 * These drive the multi-user seed (`tests/seed-fixtures.ts`), which globalSetup
 * only writes when SEED_E2E=1. That harness EXISTS — the "pending the multi-user
 * seed harness" note this file used to carry was stale.
 *
 * The originals also assumed a session would survive between tests; Playwright
 * gives each test a fresh context, so P2-P8 were driving ANONYMOUS pages at
 * routes that redirect to /login. Every test now logs in for itself, and at the
 * role the surface actually requires (the integrations page renders AccessDenied
 * for an inspector).
 */
import { test, expect } from '@playwright/test';
import { SEED_EMAILS, SEED_INSPECTIONS, SEED_TENANT_SLUG } from '../seed-fixtures';
import { loginAsSeedUser, apiGet, apiPost } from './helpers/seed-login';

test.describe('Subsystem E — pre-flight, list workflow, exports, metrics, report credit', () => {

    /**
     * P1 — the publish pre-flight gates for a half-done inspection.
     *
     * CHANGED vs the original: there is no publish modal with a disabled
     * "Send All" button and a gate checklist — that UI never shipped in the
     * React Router build. `[data-test=publish-send-all]` appears nowhere in the
     * repo. What DID ship is the aggregator itself
     * (`server/lib/preflight.ts`, five gates) behind
     * `GET /api/inspections/:id/preflight`, with NO frontend consumer. So this
     * asserts the contract at the surface that exists, against the inspection
     * the account is named for.
     *
     * Note the account: `inspector-half@seed.test` is the inspector ASSIGNED to
     * `seed-half-done-inspection` — the "half" is the report, not a seat quota.
     * An inspector can only read their own tenant's inspection, so a 200 here is
     * also the ownership assertion.
     */
    test('P1 — publish pre-flight reports every gate failing on a half-done inspection', async ({ page }) => {
        await loginAsSeedUser(page, SEED_EMAILS.inspectorHalf);

        const res = await apiGet(page, `/api/inspections/${SEED_INSPECTIONS.halfDone}/preflight`);
        expect(res.status(), await res.text()).toBe(200);
        const body = await res.json() as { data: Record<string, unknown> };

        // The five gates, named as the aggregator names them.
        expect(body.data).toMatchObject({
            allRated:              false,   // nothing rated yet
            propertyFactsComplete: false,
            coverPhotoSet:         false,
            agreementSigned:       false,
            noOpenFields:          true,    // no notes at all, so no [FIELD] tokens
        });
        expect(body.data.missingFacts).toEqual(
            ['year_built', 'sqft', 'foundation', 'bedrooms', 'bathrooms'],
        );
    });

    /**
     * P2 — the workflow tab is URL state and survives a reload.
     *
     * CHANGED vs the original: neither tab id it used exists. The live keys are
     * `all | active | requested | to_review | awaiting_payment | published |
     * cancelled` (app/lib/dashboard-schema.ts TABS) — there is no `drafts`, and
     * the payment tab is snake_case `awaiting_payment`, not `awaitingPayment`.
     * The active tab is also no longer `.bg-indigo-600`; the shared-ui TabStrip
     * marks it with the DS token class `text-ih-primary`.
     */
    test('P2 — workflow tab round-trips through the URL and survives a reload', async ({ page }) => {
        await loginAsSeedUser(page, SEED_EMAILS.admin);
        await page.goto('/inspections?workflow=published');

        const published = page.getByRole('button', { name: /^Published/ });
        await expect(published).toHaveClass(/text-ih-primary/);

        await page.getByRole('button', { name: /^Awaiting payment/ }).click();
        await expect(page).toHaveURL(/workflow=awaiting_payment/);

        await page.reload();
        await expect(page.getByRole('button', { name: /^Awaiting payment/ })).toHaveClass(/text-ih-primary/);
        await expect(page.getByRole('button', { name: /^Published/ })).not.toHaveClass(/text-ih-primary/);
    });

    /**
     * P3 — CSV export of the visible inspections.
     *
     * Unchanged in substance; the export still builds a Blob client-side and
     * downloads `inspections-YYYY-MM-DD.csv`. It no-ops on an empty list, hence
     * the owner login: the seed's six inspections are spread across two
     * inspectors, and only an owner sees all of them.
     */
    test('P3 — Export downloads the visible inspections as CSV', async ({ page }) => {
        await loginAsSeedUser(page, SEED_EMAILS.admin);
        await page.goto('/inspections');
        // Wait for rows: the export returns early on an empty list, which would
        // hang on waitForEvent('download') rather than fail with a reason.
        await expect(page.getByText('1 Empty St')).toBeVisible({ timeout: 15_000 });

        const downloadPromise = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Export', exact: true }).first().click();
        const download = await downloadPromise;
        expect(download.suggestedFilename()).toMatch(/^inspections-\d{4}-\d{2}-\d{2}\.csv$/);
    });

    /**
     * P6 — the integration cards grid.
     *
     * CHANGED vs the original on three counts: the route is `/settings/integrations`
     * (there is no `/settings/integrations-grid`); the page returns AccessDenied
     * to an inspector, so this runs as the owner; and the six cards are not the
     * six the old list named. Stripe Connect is NOT a card any more — it has its
     * own StripePaymentsPanel section above the grid — and Zapier took the slot.
     * "Resend (email)" is just "Resend".
     */
    test('P6 — the integrations grid renders its six cards', async ({ page }) => {
        await loginAsSeedUser(page, SEED_EMAILS.admin);
        await page.goto('/settings/integrations');

        // "AI provider", not "Gemini AI". The multi-provider AI work renamed the
        // card when the feature stopped being about one vendor; the message KEY
        // is still `settings_integrations_gemini_name`, so a grep for the key
        // finds nothing wrong and only the rendered value moved.
        //
        // This assertion was stale from that rename until it first ran here.
        // These specs only run on a pull request, and the work that renamed the
        // card reached main by a force-push — so nothing executed them in
        // between. The gap, not the label, is the thing worth remembering.
        for (const name of ['QuickBooks Online', 'Google Calendar', 'Google Places',
                            'Resend', 'Zapier', 'AI provider']) {
            await expect(page.getByText(name, { exact: true })).toBeVisible();
        }
        // Stripe is on this page, but as its own panel — not a grid card.
        await expect(page.getByText('Stripe Connect')).toHaveCount(0);
    });

    /**
     * P7 — the metrics charts render real data.
     *
     * CHANGED vs the original: the charts are DIV bars, not `svg polyline`, and
     * the findings surface is "Findings by Section", not a "Findings heatmap".
     * The date range also has to be stated: the seeded inspections sit on
     * 2026-06-01, and the default window is recent, so without `?from=&to=` the
     * card honestly renders "No data in this date range" and the test would be
     * asserting a heading over an empty chart.
     */
    test('P7 — /metrics renders the inspections chart with data and the findings section', async ({ page }) => {
        await loginAsSeedUser(page, SEED_EMAILS.admin);
        await page.goto('/metrics?from=2026-05-01&to=2026-08-31');

        await expect(page.getByText('Inspections per Month')).toBeVisible();
        // Data, not just a title: the empty branch replaces the bars with this line.
        await expect(page.getByText('No data in this date range.')).toHaveCount(0);
        await expect(page.getByText('Revenue per Month')).toBeVisible();
        await expect(page.getByText('Findings by Section')).toBeVisible();
    });

    /**
     * P8 — the published report credits its inspector and their credential.
     *
     * CHANGED vs the original: the route is `/report-view/:tenant/:id` (the old
     * `/reports/:id` is a redirect stub), and the page is NOT anonymously
     * readable — the public report API resolves a tenant from a recipient token
     * or an owner session and 404s otherwise, so this runs signed in as the
     * assigned inspector (owner-preview). "Inspected by" is now "Inspector:
     * {name}", and there is no hardcoded NACHI badge: credentials come from the
     * inspector's own `inspector_credentials` rows, which the seed now provides.
     */
    test('P8 — published report renders the inspector credit and their credential', async ({ page }) => {
        await loginAsSeedUser(page, SEED_EMAILS.lead);
        const id = SEED_INSPECTIONS.delivered;
        await apiPost(page, `/api/inspections/${id}/publish`, {});

        await page.goto(`/report-view/${SEED_TENANT_SLUG}/${id}`);
        await expect(page.getByText('Inspector: Lead Inspector').first()).toBeVisible();
        await expect(page.getByText('InterNACHI CPI').first()).toBeVisible();
        await expect(page.getByText('NACHI-24-0001').first()).toBeVisible();
    });
});
