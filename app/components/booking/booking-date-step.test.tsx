// @vitest-environment happy-dom
/**
 * F42 — a date an inspection cannot happen on must stop at the date field.
 *
 * Measured on the public page: the field was a bare `<input type="date">` with
 * `min=(none) max=(none) step=(none) list=(none)` and no slot UI at all. The
 * tenant's weekly hours, slot rules, company holidays and inspector territories
 * reached none of it. `2020-01-05` — a Sunday, six years past — produced no
 * client message, left Continue enabled, reached the confirm step, and was
 * rendered back as `2020-01-05`.
 *
 * This drives the REAL form state, so `canNext` is the production predicate and
 * not a restatement of it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import { BookingWizard } from "~/components/booking/BookingWizard";
import { useBookingFormState } from "~/components/booking/useBookingFormState";
import type { CompanyProfile } from "~/components/booking/booking-constants";

const PROFILE: CompanyProfile = {
    company: "Seed Tenant A",
    turnstileSiteKey: null,
    bookingOpen: true,
    inspectors: [],
    services: [
        { id: "svc-roof", name: "Roof Inspection", price: 45000, duration: 180 },
    ],
};

/** A Sunday in 2020 — the walkthrough's date, verbatim. */
const PAST_SUNDAY = "2020-01-05";

function Harness() {
    const form = useBookingFormState({
        profile: PROFILE,
        preselected: null,
        tenant: "seed-a",
        agentRefSlug: null,
    });
    return <BookingWizard profile={PROFILE} privacyUrl={null} termsUrl={null} form={form} />;
}

function renderWizard() {
    const Stub = createRoutesStub([{ path: "/", Component: Harness }]);
    render(<Stub initialEntries={["/"]} />);
}

function continueButton(): HTMLButtonElement {
    return screen.getByRole("button", { name: /continue/i }) as HTMLButtonElement;
}

/** Address -> service -> schedule, the way a visitor gets there. */
async function walkToScheduleStep() {
    renderWizard();
    fireEvent.change(screen.getByRole("combobox"), {
        target: { value: "1600 Pennsylvania Avenue NW" },
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    fireEvent.click(continueButton());
    fireEvent.click(screen.getByText("Roof Inspection"));
    fireEvent.click(continueButton());
    return screen.getByLabelText(/inspection date/i) as HTMLInputElement;
}

/** A date ~3 months out, always inside the horizon and never in the past. */
function soonDate(): string {
    const d = new Date(Date.now() + 90 * 86_400_000);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function setDate(field: HTMLInputElement, value: string) {
    fireEvent.change(field, { target: { value } });
}

function fillContact() {
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Dana Buyer" } });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "dana@example.com" } });
}

describe("public booking — the date field", () => {
    let slots: { time: string; available: boolean }[];

    beforeEach(() => {
        vi.useFakeTimers();
        slots = [{ time: "08:00", available: true }, { time: "08:30", available: true }];
        vi.stubGlobal("fetch", vi.fn(async (url: string) => {
            if (String(url).includes("/api/public/geocode")) {
                return { ok: true, json: async () => ({ data: [] }) };
            }
            return { ok: true, json: async () => ({ data: { slots } }) };
        }) as unknown as typeof fetch);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it("refuses to let a past date through, and says which field is wrong", async () => {
        const field = await walkToScheduleStep();
        fillContact();
        setDate(field, PAST_SUNDAY);
        await act(async () => { await vi.advanceTimersByTimeAsync(500); });

        expect(screen.getByRole("alert").textContent).toMatch(/already passed/i);
        // The one thing the walkthrough found: Continue was NOT disabled.
        expect(continueButton().disabled).toBe(true);
        // And nothing about a "time slot", which is the message the server used
        // to answer with four steps later.
        expect(document.body.textContent).not.toMatch(/time slot/i);
    });

    it("tells the picker itself where the range is", async () => {
        const field = await walkToScheduleStep();
        // `min=(none) max=(none)` was the measurement. Both are now set, so the
        // native calendar greys out the past instead of accepting it.
        expect(field.min).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(field.max).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(field.max > field.min).toBe(true);
    });

    // POSITIVE CONTROL: the step must still work. A Continue wired to stay
    // disabled would pass every assertion above.
    it("lets an ordinary future date through", async () => {
        const field = await walkToScheduleStep();
        fillContact();
        setDate(field, soonDate());
        await act(async () => { await vi.advanceTimersByTimeAsync(500); });

        expect(screen.queryByRole("alert")).toBeNull();
        expect(continueButton().disabled).toBe(false);
    });

    it("echoes the chosen date with its weekday, in the page's language", async () => {
        const field = await walkToScheduleStep();
        setDate(field, "2026-12-16");
        await act(async () => { await vi.advanceTimersByTimeAsync(500); });
        // F44 — the native control renders its parts in the BROWSER's language;
        // this echo is the reading that is in the page's, and the weekday is what
        // makes a wrong day visible before the last step.
        expect(document.body.textContent).toMatch(/Wednesday/);
        expect(document.body.textContent).toMatch(/December 16, 2026/);
    });

    it("stops a date the company does not work, from the company's own answer", async () => {
        // The slots endpoint folds in weekly hours, slot rules, time off,
        // holidays and territories. Nothing bookable = not a working day.
        slots = [{ time: "08:00", available: false }];
        const field = await walkToScheduleStep();
        fillContact();
        setDate(field, soonDate());
        await act(async () => { await vi.advanceTimersByTimeAsync(500); });

        expect(screen.getByRole("alert").textContent).toMatch(/no times available/i);
        expect(continueButton().disabled).toBe(true);
    });

    it("does not blame the visitor when the availability lookup fails", async () => {
        // An unreachable endpoint is not evidence about the date. Booking stays
        // possible and the server decides — fail-soft, like the geocode call.
        vi.stubGlobal("fetch", vi.fn(async () => {
            throw new Error("offline");
        }) as unknown as typeof fetch);
        const field = await walkToScheduleStep();
        fillContact();
        setDate(field, soonDate());
        await act(async () => { await vi.advanceTimersByTimeAsync(500); });

        expect(screen.queryByRole("alert")).toBeNull();
        expect(continueButton().disabled).toBe(false);
    });
});
