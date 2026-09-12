// @vitest-environment happy-dom
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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
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

import { useFetcher } from 'react-router';
import { NewInspectionWizard } from '~/components/NewInspectionWizard';
import { ADDRESS_DROPDOWN_OBSTACLE_ATTR } from '~/components/address/AddressAutocomplete';
import { anchoredDropdownPlacement } from '~/lib/dropdown-position';

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
        fireEvent.change(getByLabelText('Report template'), { target: { value: 'Standard' } });
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
        // Idempotency (portal #105): the create carries a key the server can
        // dedupe on. Without it, the guard below only narrows the window.
        expect(typeof payload.idempotencyKey).toBe('string');
        expect(payload.idempotencyKey.length).toBeGreaterThan(0);
    });

    /**
     * Portal #105, seen in production on 2026-08-05: one tenant created three
     * byte-identical inspections seconds apart. Create called `fetcher.submit`
     * with nothing guarding it and the button stayed live, so every impatient
     * click was another inspection.
     *
     * Both clicks go inside ONE act(): React batches the handlers and renders
     * nothing between them, which is what a real double click looks like and
     * why a `fetcher.state` check cannot see the second one.
     */
    it('creates one inspection when Create is clicked twice in the same tick (portal #105)', () => {
        const { getAllByRole } = walkToConfirm();
        const createBtn = (getAllByRole('button') as HTMLButtonElement[])
            .find((b) => b.textContent?.includes('Create Inspection'));
        expect(createBtn).toBeTruthy();

        act(() => {
            createBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            createBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });

        const createCalls = fetcherMocks.submit.mock.calls
            .filter((c) => (c[0] as { intent?: string })?.intent === 'create');
        expect(createCalls.length).toBe(1);
    });
});

/**
 * F1 — the Places suggestion list must not cover the wizard's footer.
 *
 * Walkthrough finding, on `/inspections/new` at 1280x720: the address field
 * ended at y=457 and the navigation footer carrying Next/Create began at y=520,
 * so a 224px list starting at 461 ran to 685 and buried the control the
 * inspector needs next. There is 255px of room before the viewport floor, so no
 * viewport-only measurement would ever move it — the footer's own top edge is
 * the only number that says the space is not free. Same shape as the public
 * booking page's Continue button (F41), one wizard further in.
 *
 * WHAT DISCRIMINATES HERE. happy-dom does no layout and no hit-testing, so
 * `getBoundingClientRect()` reads zero everywhere and clicking a covered button
 * still dispatches on the button — "Next still works" would pass with the fix
 * reverted. The page is therefore laid out by a rect spy at the measured
 * coordinates, and the assertion is geometric: the list's own box, read off the
 * inline style the hook writes, must not intersect the footer's. The second test
 * pins the same numbers against the pure placement function with no obstacle
 * named, which is what the component did before this wiring — so the pair shows
 * both that the list moves and that it had somewhere wrong to be.
 */
const F1_FIELD_RECT = { top: 421, bottom: 457, left: 232, right: 823, width: 591, height: 36 };
const F1_FOOTER_RECT = { top: 520, bottom: 566, left: 232, right: 823, width: 591, height: 46 };

/** `/resources/places` suggestions, in the shape `PlaceSuggestion` declares. */
const F1_PLACES = [
    {
        placeId: 'place-nw',
        description: '1600 Pennsylvania Avenue NW, Washington, DC 20500',
        mainText: '1600 Pennsylvania Avenue NW',
        secondaryText: 'Washington, DC 20500',
    },
    {
        placeId: 'place-south',
        description: '1600 Pennsylvania Avenue South, Washington, DC 20003',
        mainText: '1600 Pennsylvania Avenue South',
        secondaryText: 'Washington, DC 20003',
    },
];

describe('NewInspectionWizard — address suggestions vs the wizard footer (F1)', () => {
    const mockedUseFetcher = vi.mocked(useFetcher);
    let restoreFetcher: (() => void) | null = null;
    let rectSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        window.innerHeight = 720;
        window.innerWidth = 1280;

        // Every fetcher in the wizard answers with the Places payload, because
        // the file's module mock deliberately stopped keying fetchers by call
        // order. Only the address input reads `suggestions`; the create effect
        // keys on `intent === 'create'` and the conflict/holiday consumers treat
        // an unrecognised body as nothing to report, so this stays local to the
        // address list. The previous implementation is put back in afterEach.
        const previous = mockedUseFetcher.getMockImplementation();
        mockedUseFetcher.mockImplementation((() => ({
            state: 'idle',
            data: { suggestions: F1_PLACES },
            submit: fetcherMocks.submit,
            load: vi.fn(),
            Form: ({ children, ...props }: { children: React.ReactNode; [k: string]: unknown }) =>
                createElement('form', props, children),
        })) as never);
        restoreFetcher = () => {
            if (previous) mockedUseFetcher.mockImplementation(previous);
        };

        // Lay the page out where the walkthrough measured it. Everything else
        // reads zero, which is what an unlaid-out element reports anyway — and
        // a zero-height obstacle is ignored by the hook by design.
        rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
            function (this: Element) {
                if ((this as HTMLElement).id === 'property-address') return F1_FIELD_RECT as DOMRect;
                if (this.hasAttribute(ADDRESS_DROPDOWN_OBSTACLE_ATTR)) return F1_FOOTER_RECT as DOMRect;
                return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 } as DOMRect;
            },
        );
    });

    afterEach(() => {
        rectSpy.mockRestore();
        restoreFetcher?.();
        restoreFetcher = null;
    });

    /**
     * Types an address and waits for the list the 250ms debounce opens.
     *
     * REAL timers, deliberately. React 19 flushes asynchronously, so the list
     * has to be awaited rather than read straight after the keystroke — and
     * under an installed fake clock `findBy*`/`waitFor` never return at all
     * (their polling loop flushes through React's act, which schedules work on
     * timers nobody is advancing once the loop owns the turn). Waiting 250ms for
     * real is the cheaper of the two, and it is the assertion that matters.
     */
    async function openAddressSuggestions() {
        render(<NewInspectionWizard open onClose={() => {}} templates={[]} />);
        const input = screen.getByPlaceholderText('123 Main St, City, State') as HTMLInputElement;
        fireEvent.change(input, { target: { value: '1600 Pennsylvania' } });
        return { input, list: await screen.findByRole('listbox') };
    }

    /** The list's own viewport box, read off the inline style the hook writes. */
    function listBox(list: HTMLElement) {
        const top = parseFloat(list.style.top);
        return { top, bottom: top + parseFloat(list.style.maxHeight) };
    }

    it('leaves the Next/Create footer uncovered', async () => {
        const { list } = await openAddressSuggestions();
        expect(list.style.position).toBe('fixed');
        const { top, bottom } = listBox(list);
        const overlap = Math.min(bottom, F1_FOOTER_RECT.bottom) - Math.max(top, F1_FOOTER_RECT.top);
        expect(overlap).toBeLessThanOrEqual(0);
        expect(bottom).toBeLessThanOrEqual(F1_FOOTER_RECT.top);
        // And the control underneath is still there, reachable by its name.
        expect(screen.getByRole('button', { name: /next/i })).toBeTruthy();
    });

    it('would have covered the footer had the obstacle not been named', async () => {
        const { list } = await openAddressSuggestions();
        const placed = listBox(list);
        // The same geometry with no obstacle — what this component asked for
        // before the wiring. It runs to 685, straight over a footer at 520.
        const blind = anchoredDropdownPlacement(
            { top: F1_FIELD_RECT.top, bottom: F1_FIELD_RECT.bottom, left: F1_FIELD_RECT.left, width: F1_FIELD_RECT.width },
            720,
            { viewportWidth: 1280 },
        );
        expect(blind.top + blind.maxHeight).toBeGreaterThan(F1_FOOTER_RECT.top);
        // So the list the wizard actually renders is NOT the blind placement.
        expect(placed.bottom).not.toBe(blind.top + blind.maxHeight);
    });

    it('still lets the inspector pick a suggestion', async () => {
        const { input } = await openAddressSuggestions();
        fireEvent.mouseDown(screen.getAllByRole('option')[1]);
        await waitFor(() => {
            expect(input.value).toBe(F1_PLACES[1].description);
        });
    });
});
