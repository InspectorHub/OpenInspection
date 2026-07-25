/**
 * Free-tier "at cap" gate — the New Inspection wizard should show the
 * upgrade panel IMMEDIATELY when it opens for a tenant already at the free
 * plan's inspection cap, instead of only catching the server's 402
 * QUOTA_EXHAUSTED after the inspector fills all the steps and hits Create.
 *
 * The `quotaExceededAtOpen` prop is optional and reuses the same tri-state
 * semantics as the internal 402-driven `quotaExceeded` state:
 *   - undefined → no gate (caller has no quota context, or tenant is under
 *     cap / standalone / paid-saas) → normal wizard; server 402 still
 *     backstops a race.
 *   - null      → at cap, no billingPortalUrl configured (CTA hidden).
 *   - string    → at cap, billingPortalUrl for the "Subscribe" CTA.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { createElement } from 'react';

const fetcherMocks = {
    submit: vi.fn(),
};

/**
 * Every fetcher gets the SAME idle, dataless shape and the same submit spy, and
 * the assertions below select the call they mean by its `intent`.
 *
 * The previous mock keyed off call ORDER: index 1 was the agent search, index 2
 * returned `{ conflicts: [] }`, and so on. Two things were wrong with that. The
 * wizard re-renders as the form is filled, so the counter kept climbing and the
 * "index 0" create fetcher stopped being index 0 after the first render — which
 * is why the payload assertion only ever ran under an `if`. And adding a fetcher
 * (the client search, here) shifted every later index onto the wrong consumer.
 * Each consumer already treats absent data as "nothing to report".
 */
vi.mock('react-router', async () => {
    const actual = await vi.importActual<typeof import('react-router')>('react-router');
    const idleFetcher = (submit: () => void) => ({
        state: 'idle',
        data: undefined,
        submit,
        load: vi.fn(),
        Form: ({ children, ...props }: { children: React.ReactNode; [k: string]: unknown }) =>
            createElement('form', props, children),
    });

    return {
        ...actual,
        // The wizard reads the viewer's timezone from the auth-layout loader
        // (useDisplayTimeZone). Outside a data router that hook THROWS rather
        // than returning null, so the session context has to be supplied here.
        useRouteLoaderData: vi.fn(() => ({
            context: {
                user: { timezone: 'UTC' },
                branding: { defaultTimezone: 'UTC' },
            },
        })),
        useFetcher: vi.fn(() => idleFetcher(fetcherMocks.submit)),
    };
});

import { NewInspectionWizard } from '~/components/NewInspectionWizard';

describe('NewInspectionWizard — at-open quota gate', () => {
    beforeEach(() => {
        fetcherMocks.submit.mockClear();
    });

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

/**
 * Plan 1B Task 7 — the wizard must carry the client and the buyer agent into the
 * create payload, so the action can write the inspection_people rows.
 *
 * The earlier version of this test wrapped every step in `if (button) click` and
 * ended with `if (createBtn enabled) { assert the payload } else { assert the
 * inputs still hold what we typed }`, so it passed whether or not a submission
 * ever happened — a contract guard that could not fail. It walks the wizard for
 * real now, which also covers the Batch D shape: one template combobox, a client
 * field that searches Contacts, and a final Confirm step that states what is
 * about to be created.
 */
describe('NewInspectionWizard — client + buyer-agent payload', () => {
    beforeEach(() => {
        fetcherMocks.submit.mockClear();
    });

    function walkToConfirm() {
        const view = render(
            <NewInspectionWizard
                open
                onClose={vi.fn()}
                templates={[{ id: 'tpl-1', name: 'Standard Inspection' }]}
                services={[{ id: 'svc-1', name: 'General Inspection', price: 25000 }]}
                teamMembers={[]}
            />,
        );
        const { getByPlaceholderText, getByText, getByLabelText, getAllByRole } = view;

        // ── Property: address + template ────────────────────────────────────
        fireEvent.change(getByPlaceholderText(/123 Main|St.*City/i), {
            target: { value: '123 Main Street' },
        });
        // One combobox, not a filter box + a select + an echo line. Typing
        // filters; only picking selects.
        fireEvent.change(getByLabelText('Template'), { target: { value: 'Standard' } });
        fireEvent.mouseDown(getByText('Standard Inspection'));

        const clickNext = () => {
            const next = (getAllByRole('button') as HTMLButtonElement[])
                .find((b) => b.textContent?.includes('Next'));
            expect(next).toBeTruthy();
            expect(next!.hasAttribute('disabled')).toBe(false);
            fireEvent.click(next!);
        };
        clickNext();

        // ── People: client (searchable) + a new agent ───────────────────────
        const inputs = getAllByRole('textbox') as HTMLInputElement[];
        fireEvent.change(inputs[0], { target: { value: 'John Client' } });
        fireEvent.change(inputs[1], { target: { value: 'john@example.com' } });
        fireEvent.change(inputs[2], { target: { value: '555-0123' } });
        fireEvent.click(getByText(/new agent/i));
        const afterAgent = getAllByRole('textbox') as HTMLInputElement[];
        fireEvent.change(afterAgent[afterAgent.length - 2], { target: { value: 'Amy Agent' } });
        fireEvent.change(afterAgent[afterAgent.length - 1], { target: { value: 'amy@realty.com' } });
        clickNext();

        // ── Services (each row is a toggle button, not a checkbox) ─────────
        const serviceToggle = (getAllByRole('button') as HTMLButtonElement[])
            .find((b) => b.textContent?.includes('General Inspection'));
        expect(serviceToggle).toBeTruthy();
        fireEvent.click(serviceToggle!);
        clickNext();

        return view;
    }

    it('reviews what will be created on the final step', () => {
        const { getByText } = walkToConfirm();
        // The last step used to be one date field with Create beside it.
        expect(getByText('Review')).toBeTruthy();
        expect(getByText('123 Main Street')).toBeTruthy();
        expect(getByText('Standard Inspection')).toBeTruthy();
        expect(getByText(/John Client · john@example.com · 555-0123/)).toBeTruthy();
        expect(getByText('Amy Agent')).toBeTruthy();
        expect(getByText(/General Inspection · \$250\.00/)).toBeTruthy();
        // Solo workspace (no team members) — the inspection goes to the creator.
        expect(getByText('You')).toBeTruthy();
    });

    it('submits the client and the new agent it collected', () => {
        const { getAllByRole } = walkToConfirm();
        const createBtn = (getAllByRole('button') as HTMLButtonElement[])
            .find((b) => b.textContent?.includes('Create Inspection'));
        expect(createBtn).toBeTruthy();
        expect(createBtn!.hasAttribute('disabled')).toBe(false);
        fireEvent.click(createBtn!);

        const createCall = fetcherMocks.submit.mock.calls
            .find((c) => (c[0] as { intent?: string })?.intent === 'create');
        expect(createCall).toBeTruthy();
        const payload = createCall![0];
        expect(payload).toHaveProperty('clientName', 'John Client');
        expect(payload).toHaveProperty('clientEmail', 'john@example.com');
        expect(payload).toHaveProperty('clientPhone', '555-0123');
        expect(payload).toHaveProperty('newAgentName', 'Amy Agent');
        expect(payload).toHaveProperty('newAgentEmail', 'amy@realty.com');
        expect(payload).toHaveProperty('templateId', 'tpl-1');
        // Batch C — the wizard sends the zone it displayed, not a bare local time.
        expect(payload).toHaveProperty('timeZone', 'UTC');
    });
});
