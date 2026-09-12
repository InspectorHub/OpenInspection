// @vitest-environment happy-dom
/**
 * F44 — the confirm and confirmation screens must say what was booked.
 *
 * Measured on the public page:
 *   - `Date  2020-01-05` — a bare ISO string, no weekday. With the weekday on it,
 *     a Sunday announces itself before the client commits.
 *   - `Services  1 selected`, with `Total $450.00` on the very next line: the one
 *     number the client is agreeing to named nothing.
 *   - after submitting, a green tick and a sentence — and nothing at all about the
 *     appointment that now exists.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import { ConfirmStep } from "~/components/booking/BookingSteps";

const BASE = {
    address: "1600 Pennsylvania Avenue NW, Washington, DC 20500",
    inspectionDate: "2020-01-05",
    timeWindow: "morning",
    customTime: "",
    selectedServices: new Set(["svc-roof"]),
    selectedServiceNames: ["Roof Inspection"],
    showInspectorDropdown: false,
    chosenInspectorName: "",
    totalPrice: 450,
    clientName: "Dana Buyer",
    clientEmail: "dana@example.com",
    depositQuoteCents: 0,
    depositDueCents: null,
    bookedInspectionId: null,
    currency: "USD",
    companyName: "Acme Inspections",
};

function renderConfirm(over: Record<string, unknown> = {}) {
    // Typed as the component's own props, not `never`: `never` is not spreadable,
    // so `<ConfirmStep {...props} />` below would not compile.
    const props = { ...BASE, message: null, ...(over as object) } as unknown as Parameters<typeof ConfirmStep>[0];
    const Stub = createRoutesStub([{ path: "/", Component: () => <ConfirmStep {...props} /> }]);
    render(<Stub initialEntries={["/"]} />);
}

describe("booking confirm — before submitting", () => {
    it("reads the date as a person does, weekday included", () => {
        renderConfirm();
        expect(screen.getByText(/Sunday, January 5, 2020/)).toBeTruthy();
        // DISCRIMINATING: the raw ISO must not be on the page at all.
        expect(document.body.textContent).not.toMatch(/2020-01-05/);
    });

    it("names the services behind the total", () => {
        renderConfirm();
        expect(screen.getByText("Roof Inspection")).toBeTruthy();
        expect(document.body.textContent).not.toMatch(/1 selected/);
        expect(document.body.textContent).toMatch(/\$450\.00/);
    });

    it("lists every service when several were picked", () => {
        renderConfirm({
            selectedServices: new Set(["a", "b"]),
            selectedServiceNames: ["Roof Inspection", "Radon Testing"],
        });
        expect(screen.getByText("Roof Inspection")).toBeTruthy();
        expect(screen.getByText("Radon Testing")).toBeTruthy();
    });

    // FALLBACK: a catalogue that did not load must not leave the row blank. The
    // count is a fact about the form, so it is the fallback and not the answer.
    it("falls back to the count when no names came through", () => {
        renderConfirm({ selectedServiceNames: [] });
        expect(screen.getByText(/1 selected/)).toBeTruthy();
    });
});

describe("booking confirmation — after submitting", () => {
    const submitted = {
        message: { ok: true, text: "We'll confirm by email shortly." },
        inspectionDate: "2026-09-16",
    };

    it("says what was booked, not just that something was", () => {
        renderConfirm(submitted);
        // The tick and the sentence are still there.
        expect(document.body.textContent).toMatch(/confirm by email/i);
        // DISCRIMINATING: and now so is the appointment.
        expect(screen.getByText(/Wednesday, September 16, 2026/)).toBeTruthy();
        expect(screen.getByText("Roof Inspection")).toBeTruthy();
        expect(screen.getByText(BASE.address)).toBeTruthy();
        expect(document.body.textContent).toMatch(/\$450\.00/);
    });

    it("never prints a raw ISO timestamp", () => {
        renderConfirm(submitted);
        expect(document.body.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}/);
        expect(document.body.textContent).not.toMatch(/T\d{2}:\d{2}/);
    });
});
