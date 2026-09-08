// @vitest-environment happy-dom
/**
 * The public booking form's final button never sits dead and silent.
 *
 * It used to read `disabled={submitting || (needsTurnstile && !turnstileToken)}`.
 * On the confirm step every field is already filled, so the only thing holding
 * it was a Turnstile token — and when the widget had not produced one the
 * client saw a greyed-out "Request Inspection", no widget, and no explanation.
 * If the challenge script cannot load at all (a blocked network, which is the
 * documented reality for some regions) that state is permanent and silent.
 * This is the last button in the acquisition funnel.
 *
 * WHY ENABLED-AND-EXPLAIN RATHER THAN DISABLED:
 *
 *   GOV.UK Design System: "Disabled buttons have poor contrast and can confuse
 *   some users, so avoid them if possible. Only use disabled buttons if
 *   research shows it makes the user interface easier to understand."
 *
 *   Nielsen Norman Group, the one authority that permits disabling at all:
 *   "A disabled control must not be a communication dead end" — and for forms
 *   specifically, "allow the primary action and show errors as needed, rather
 *   than trying to preempt every possible error state with disabled controls."
 *
 *   The staff-facing wizard in this same app already does it right, stating
 *   "Select at least one service" beside its disabled Next; the agent signup
 *   keeps its submit live and reports the unticked terms after the click. Only
 *   the client-facing flow — the one that earns the money — did neither.
 *
 * `submitting` still disables: the action has already been taken and the guard
 * is against sending it twice, which is a different question from "you may
 * not act yet".
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import { BookingWizard } from "~/components/booking/BookingWizard";

const PROFILE = {
    company: "Seed Tenant A",
    turnstileSiteKey: "1x00000000000000000000AA",
    inspectors: [],
    services: [],
} as never;

function formBag(over: Record<string, unknown>) {
    const noop = () => {};
    return {
        step: 3, setStep: noop,
        address: "1 Main St", setAddress: noop, setAddressPick: noop,
        selectedServices: new Set(["svc"]),
        inspectionDate: "2026-06-18", setInspectionDate: noop,
        timeWindow: "morning", setTimeWindow: noop,
        customTime: "", setCustomTime: noop,
        clientName: "Dana Buyer", setClientName: noop,
        clientEmail: "dana@example.com", setClientEmail: noop,
        smsOptin: false, setSmsOptin: noop,
        locale: "en", setLocale: noop,
        chosenInspectorId: "", setChosenInspectorId: noop,
        submitting: false,
        message: null,
        turnstileToken: "", setTurnstileToken: noop,
        turnstileRef: { current: null },
        toggleService: noop,
        totalPrice: 45000,
        depositQuoteCents: null, depositDueCents: null,
        bookedInspectionId: null,
        currency: "USD",
        needsTurnstile: true,
        canNext: true,
        inspectorOptions: [],
        chosenInspectorName: null,
        handleSubmit: noop,
        tenant: "seed-a",
        prefilledFromDevice: false,
        clearRememberedContact: noop,
        rememberContact: false,
        ...over,
    } as never;
}

function renderWizard(over: Record<string, unknown> = {}) {
    // The confirm step reads the viewer's display locale off the router, so the
    // wizard needs a router around it even though nothing here routes.
    const Stub = createRoutesStub([
        {
            path: "/",
            Component: () => (
                <BookingWizard
                    profile={PROFILE}
                    privacyUrl={null}
                    termsUrl={null}
                    form={formBag(over)}
                />
            ),
        },
    ]);
    render(<Stub initialEntries={["/"]} />);
}

/** The final submit. Its label swaps to the pending copy while in flight. */
function submitButton(pending = false): HTMLButtonElement {
    return screen.getByRole("button", {
        name: pending ? /submitting/i : /request inspection/i,
    }) as HTMLButtonElement;
}

describe("public booking submit", () => {
    it("stays usable while the verification token is still missing", () => {
        renderWizard();
        expect(submitButton().disabled).toBe(false);
    });

    it("says why instead of submitting, when the token is missing", () => {
        const handleSubmit = vi.fn();
        renderWizard({ handleSubmit });
        fireEvent.click(submitButton());
        expect(handleSubmit).not.toHaveBeenCalled();
        expect(screen.getByText(/verification/i)).toBeTruthy();
    });

    // POSITIVE CONTROL: with a token the click must go through untouched.
    // Without this, a button wired to never submit would pass the test above.
    it("submits normally once the token is there", () => {
        const handleSubmit = vi.fn();
        renderWizard({ handleSubmit, turnstileToken: "tok" });
        fireEvent.click(submitButton());
        expect(handleSubmit).toHaveBeenCalledTimes(1);
    });

    // The one disable that stays: guarding an in-flight submit is not the same
    // as pre-empting an unmet precondition.
    it("still disables itself while a submit is in flight", () => {
        // The label swaps to the pending copy while in flight, so query that.
        renderWizard({ submitting: true, turnstileToken: "tok" });
        expect(submitButton(true).disabled).toBe(true);
    });
});
