// @vitest-environment happy-dom
/**
 * F41 — the address suggestion list must not cover Continue.
 *
 * Measured on `/book/:tenant` at 1280x720 before the fix:
 *
 *   Continue button  [724, 530, 823, 566]
 *   suggestion list  [232, 457, 823, 643]
 *   elementFromPoint(button centre) -> LI "1600 Pennsylvania Avenue South…"
 *   vertical overlap 36px, against a button 36px tall
 *
 * The button was covered COMPLETELY, and it was not disabled, so a visitor
 * reaching for it picked a suggestion instead — silently replacing the address
 * they had just chosen with a different house number. Every potential customer
 * walks this step; it is not an internal wizard.
 *
 * WHAT IN HERE ACTUALLY DISCRIMINATES, AND WHAT DOES NOT.
 *
 * jsdom/happy-dom do no hit-testing: `fireEvent.click(button)` dispatches on the
 * button whatever is painted over it, so "the address survives a Continue click"
 * passes with the fix reverted. It is kept as a regression guard on the VALUE
 * (the dashboard twin of this bug damaged the address, not just the click) and
 * is paired with a positive control proving the mechanism that damaged it is
 * live in this test. The assertions that fail without the fix are the two
 * geometric ones: the list is portaled and `position: fixed`, and its own box
 * does not intersect the footer's.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { useState } from "react";

import { BookingWizard } from "~/components/booking/BookingWizard";
import { BOOKING_DROPDOWN_OBSTACLE_ATTR } from "~/components/booking/PublicAddressAutocomplete";

/** The field, where it really sat: bottom edge at 457 in a 720-tall viewport. */
const FIELD_RECT = { top: 421, bottom: 457, left: 232, right: 823, width: 591, height: 36 };
/** The navigation footer holding Continue. */
const FOOTER_RECT = { top: 520, bottom: 566, left: 232, right: 823, width: 591, height: 46 };

const SUGGESTIONS = [
    {
        label: "1600 Pennsylvania Avenue NW, Washington, DC 20500",
        line1: "1600 Pennsylvania Avenue NW",
        city: "Washington",
        state: "DC",
        zip: "20500",
        placeId: "place-nw",
    },
    {
        label: "1600 Pennsylvania Avenue South, Washington, DC 20003",
        line1: "1600 Pennsylvania Avenue South",
        city: "Washington",
        state: "DC",
        zip: "20003",
        placeId: "place-south",
    },
];

const PROFILE = {
    company: "Seed Tenant A",
    turnstileSiteKey: null,
    inspectors: [],
    services: [],
} as never;

const TYPED = "1600 Pennsylvania";

/** The wizard's form bag, with a REAL address state so damage is observable. */
function Harness() {
    const [address, setAddress] = useState(TYPED);
    const noop = () => {};
    const form = {
        step: 0, setStep: noop,
        address, setAddress, setAddressPick: noop,
        selectedServices: new Set<string>(),
        inspectionDate: "", setInspectionDate: noop,
        timeWindow: "morning", setTimeWindow: noop,
        customTime: "", setCustomTime: noop,
        clientName: "", setClientName: noop,
        clientEmail: "", setClientEmail: noop,
        smsOptin: false, setSmsOptin: noop,
        locale: null, setLocale: noop,
        chosenInspectorId: null, setChosenInspectorId: noop,
        submitting: false,
        message: null,
        turnstileToken: null, setTurnstileToken: noop,
        turnstileRef: { current: null },
        toggleService: noop,
        totalPrice: 0,
        depositQuoteCents: 0, depositDueCents: null,
        bookedInspectionId: null,
        currency: "USD",
        needsTurnstile: false,
        canNext: true,
        inspectorOptions: [],
        chosenInspectorName: "",
        handleSubmit: noop,
        tenant: "seed-a",
        prefilledFromDevice: false,
        clearRememberedContact: noop,
        rememberContact: true,
        dateIssue: null,
        dateUnbookable: false,
        setDateUnbookable: noop,
        selectedServiceNames: [],
    } as never;
    return (
        <BookingWizard profile={PROFILE} privacyUrl={null} termsUrl={null} form={form} />
    );
}

function renderStepOne() {
    const Stub = createRoutesStub([{ path: "/", Component: Harness }]);
    render(<Stub initialEntries={["/"]} />);
}

/** Opens the list by typing one more character and letting the debounce run. */
async function openSuggestions() {
    const input = screen.getByRole("combobox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: `${TYPED} Avenue` } });
    await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
    });
    return input;
}

function listbox(): HTMLElement {
    return screen.getByRole("listbox");
}

/** The list's own viewport box, read off the inline style the hook writes. */
function listBox(): { top: number; bottom: number } {
    const el = listbox();
    const top = parseFloat(el.style.top);
    const maxHeight = parseFloat(el.style.maxHeight);
    return { top, bottom: top + maxHeight };
}

describe("public booking — address suggestions vs the Continue button", () => {
    let rectSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.useFakeTimers();
        window.innerHeight = 720;
        window.innerWidth = 1280;
        // Lay the page out where it was measured. Everything else reads zero,
        // which is what an unlaid-out element reports anyway.
        rectSpy = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
            function (this: Element) {
                if ((this as HTMLElement).id === "booking-address") return FIELD_RECT as DOMRect;
                if (this.hasAttribute(BOOKING_DROPDOWN_OBSTACLE_ATTR)) return FOOTER_RECT as DOMRect;
                return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 } as DOMRect;
            },
        );
        vi.stubGlobal("fetch", vi.fn(async () => ({
            ok: true,
            json: async () => ({ data: SUGGESTIONS }),
        })) as unknown as typeof fetch);
    });

    afterEach(() => {
        rectSpy.mockRestore();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    // DISCRIMINATING — the old list was `absolute` inside the field's wrapper.
    it("renders the list outside the form, positioned against the viewport", async () => {
        renderStepOne();
        await openSuggestions();
        const list = listbox();
        expect(list.style.position).toBe("fixed");
        // Portaled: its parent is <body>, not the field's wrapper. An `absolute`
        // list inside the wrapper is also the one a scrolling panel clips.
        expect(list.parentElement).toBe(document.body);
        expect(screen.getByRole("combobox").closest("div")?.contains(list)).toBe(false);
    });

    // DISCRIMINATING — this is F41 itself, as a number.
    it("leaves the Continue footer uncovered", async () => {
        renderStepOne();
        await openSuggestions();
        const { top, bottom } = listBox();
        const overlap = Math.min(bottom, FOOTER_RECT.bottom) - Math.max(top, FOOTER_RECT.top);
        expect(overlap).toBeLessThanOrEqual(0);
        // And the button is still reachable by its accessible name, unchanged.
        expect(screen.getByRole("button", { name: /continue/i })).toBeTruthy();
    });

    // POSITIVE CONTROL for the guard below: picking a suggestion DOES rewrite
    // the address, so an address that survives a Continue click survived
    // something that was capable of changing it.
    it("replaces the address when a suggestion is genuinely picked", async () => {
        renderStepOne();
        const input = await openSuggestions();
        fireEvent.mouseDown(screen.getAllByRole("option")[1]);
        expect(input.value).toBe(SUGGESTIONS[1].label);
    });

    // VALUE GUARD (not discriminating under happy-dom, see the file header).
    it("keeps the typed address when the visitor presses Continue", async () => {
        renderStepOne();
        const input = await openSuggestions();
        const before = input.value;
        fireEvent.click(screen.getByRole("button", { name: /continue/i }));
        expect(input.value).toBe(before);
        expect(input.value).not.toBe(SUGGESTIONS[1].label);
    });
});
