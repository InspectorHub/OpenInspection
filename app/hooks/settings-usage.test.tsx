/**
 * Final-review Fix 4 — Settings → Usage must not show a permanently-0
 * Inspections meter for standalone deploys. `usage.inspections` is only ever
 * written by the SaaS free-tier consume path (PlanQuotaGuard.consumeInspection),
 * so a standalone deploy's card would forever read "Inspections — 0".
 *
 * `caps` alone can't distinguish standalone from a paid SaaS tenant (both are
 * null — see tests/unit/usage-summary-api.spec.ts), so the fix gates the card
 * on `isSaas` from session context instead. Paid SaaS tenants keep seeing the
 * card (lifetime analytics); only standalone hides it.
 *
 * Pattern mirrors tests/web/unit/connected-apps.spec.ts: mock react-router's
 * useLoaderData + ~/hooks/useSessionContext, render via renderToStaticMarkup.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

const mockLoaderData = { usage: {} };
vi.mock('react-router', async () => {
    const actual = await vi.importActual<typeof import('react-router')>('react-router');
    return {
        ...actual,
        useLoaderData: vi.fn(() => mockLoaderData),
        Link: ({ to, children, ...props }: { to: string; children: React.ReactNode; [k: string]: unknown }) =>
            createElement('a', { href: to, ...props }, children),
    };
});

vi.mock('~/hooks/useSessionContext', () => ({
    useSessionContext: vi.fn(),
}));

import SettingsUsagePage from '~/routes/settings-usage';
import { useLoaderData } from 'react-router';
import { useSessionContext } from '~/hooks/useSessionContext';

function sessionCtx(isSaas: boolean) {
    return {
        user: { role: 'owner', name: 'Alice', email: 'alice@example.com', initials: 'A' },
        branding: { isSaas, companyName: 'Test Co', primaryColor: '#000', logoUrl: null, defaultProfileId: 'signature', tenantSlug: null, tenantStatus: 'active', currentUserSlug: null, bookingHost: null, portalBaseUrl: null, privacyUrl: null },
        deployment: { mode: isSaas ? 'saas' : 'standalone', hasBilling: isSaas, hasSeatQuota: isSaas, mcpEnabled: true },
        seatUsage: null,
    };
}

describe('SettingsUsagePage — Inspections meter visibility (Fix 4)', () => {
    it('hides the Inspections card in standalone mode (isSaas=false)', () => {
        vi.mocked(useLoaderData).mockReturnValue({
            usage: { tier: 'free', caps: null, usage: { inspections: 0, sms: 3, email: 1, r2Bytes: 1024 } },
        } as never);
        vi.mocked(useSessionContext).mockReturnValue(sessionCtx(false) as never);

        const html = renderToStaticMarkup(createElement(SettingsUsagePage));
        expect(html).not.toContain('Inspections');
        // Sibling meters still render.
        expect(html).toContain('SMS sent');
        expect(html).toContain('Emails sent');
        expect(html).toContain('Storage used');
    });

    it('shows the Inspections card for a free SaaS tenant (capped)', () => {
        vi.mocked(useLoaderData).mockReturnValue({
            usage: { tier: 'free', caps: { inspections: 5, sms: 50, email: 50 }, usage: { inspections: 3, sms: 3, email: 1, r2Bytes: 1024 } },
        } as never);
        vi.mocked(useSessionContext).mockReturnValue(sessionCtx(true) as never);

        const html = renderToStaticMarkup(createElement(SettingsUsagePage));
        expect(html).toContain('Inspections');
        expect(html).toContain('/ 5');
    });

    it('shows the Inspections card for a paid SaaS tenant even though caps is null', () => {
        // Paid tenants have caps=null too (same as standalone) — isSaas is the
        // only signal that can tell them apart; this pins that paid tenants
        // still get the lifetime-analytics card.
        vi.mocked(useLoaderData).mockReturnValue({
            usage: { tier: 'pro', caps: null, usage: { inspections: 42, sms: 3, email: 1, r2Bytes: 1024 } },
        } as never);
        vi.mocked(useSessionContext).mockReturnValue(sessionCtx(true) as never);

        const html = renderToStaticMarkup(createElement(SettingsUsagePage));
        expect(html).toContain('Inspections');
        expect(html).toContain('42');
    });
});
