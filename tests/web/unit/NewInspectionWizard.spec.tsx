/**
 * Free-tier "at cap" gate — the New Inspection wizard should show the
 * upgrade panel IMMEDIATELY when it opens for a tenant already at the free
 * plan's inspection cap, instead of only catching the server's 402
 * QUOTA_EXHAUSTED after the inspector fills all four steps and hits Create.
 *
 * The `quotaExceededAtOpen` prop is optional and reuses the same tri-state
 * semantics as the internal 402-driven `quotaExceeded` state:
 *   - undefined → no gate (caller has no quota context, or tenant is under
 *     cap / standalone / paid-saas) → normal wizard; server 402 still
 *     backstops a race.
 *   - null      → at cap, no billingPortalUrl configured (CTA hidden).
 *   - string    → at cap, billingPortalUrl for the "Subscribe" CTA.
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { createElement } from 'react';

vi.mock('react-router', async () => {
    const actual = await vi.importActual<typeof import('react-router')>('react-router');
    return {
        ...actual,
        useFetcher: vi.fn(() => ({
            state: 'idle',
            data: undefined,
            submit: vi.fn(),
            load: vi.fn(),
            Form: ({ children, ...props }: { children: React.ReactNode; [k: string]: unknown }) =>
                createElement('form', props, children),
        })),
    };
});

import { NewInspectionWizard } from '~/components/NewInspectionWizard';

describe('NewInspectionWizard — at-open quota gate', () => {
    it('renders the upgrade panel immediately when quotaExceededAtOpen is set (at cap)', () => {
        const { getByText, queryByText } = render(
            <NewInspectionWizard
                open
                onClose={() => {}}
                quotaExceededAtOpen="https://billing.example.com"
            />,
        );
        expect(getByText(/Free plan limit reached/)).toBeTruthy();
        expect(getByText('Subscribe')).toBeTruthy();
        // No step-1 form — the wizard must not let the user walk the steps.
        expect(queryByText('Property Type')).toBeNull();
        expect(queryByText('Next')).toBeNull();
        expect(queryByText('Create Inspection')).toBeNull();
    });

    it('renders the upgrade panel with no CTA when quotaExceededAtOpen is null (no billing portal)', () => {
        const { getByText, queryByText } = render(
            <NewInspectionWizard open onClose={() => {}} quotaExceededAtOpen={null} />,
        );
        expect(getByText(/Free plan limit reached/)).toBeTruthy();
        expect(queryByText('Subscribe')).toBeNull();
    });

    it('renders the normal step-1 form when under cap (quotaExceededAtOpen undefined)', () => {
        const { getByText, queryByText } = render(
            <NewInspectionWizard open onClose={() => {}} quotaExceededAtOpen={undefined} />,
        );
        expect(queryByText(/Free plan limit reached/)).toBeNull();
        expect(getByText('Property Type')).toBeTruthy();
    });

    it('renders the normal step-1 form when the prop is omitted entirely (caps null / standalone / paid-saas / other mounts)', () => {
        const { getByText, queryByText } = render(
            <NewInspectionWizard open onClose={() => {}} />,
        );
        expect(queryByText(/Free plan limit reached/)).toBeNull();
        expect(getByText('Property Type')).toBeTruthy();
    });
});
