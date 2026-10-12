// @vitest-environment happy-dom
/**
 * Free-tier/seat-capped "at limit" gate — the Invite drawer should show the
 * seat-limit panel IMMEDIATELY when it opens for a tenant already at its
 * seat cap, instead of only catching the server's 402 SEAT_LIMIT_REACHED
 * after the inviter fills in email/role/permissions and clicks Send invite.
 *
 * The `seatLimitAtOpen` prop is optional and mirrors the tri-state pattern
 * used by NewInspectionWizard's `quotaExceededAtOpen` (see
 * tests/web/unit/NewInspectionWizard.spec.tsx / commit b4f973fd):
 *   - undefined → no gate (caller has no quota context, or tenant is under
 *     its seat limit / unlimited) → normal invite form; server 402 still
 *     backstops a race.
 *   - { used, max, billingUrl } → at cap; billingUrl omitted hides the CTA.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { useFetcher } from "react-router";
import { createElement } from "react";

vi.mock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    return {
        ...actual,
        useFetcher: vi.fn(() => ({
            state: "idle",
            data: undefined,
            submit: vi.fn(),
            load: vi.fn(),
            Form: ({ children, ...props }: { children: React.ReactNode; [k: string]: unknown }) =>
                createElement("form", props, children),
        })),
    };
});

import { InviteSeatDrawer } from "~/components/modals/InviteSeatDrawer";

describe("InviteSeatDrawer — at-open seat-limit gate", () => {
    it("renders the seat-limit panel immediately when seatLimitAtOpen is set (at cap, with billing URL)", () => {
        const { getByText, queryByText } = render(
            <InviteSeatDrawer
                open
                onClose={() => {}}
                seatLimitAtOpen={{ used: 3, max: 3, billingUrl: "https://billing.example.com" }}
            />,
        );
        expect(getByText(/Seat limit reached/)).toBeTruthy();
        expect(getByText("Upgrade")).toBeTruthy();
        // No invite form — the inviter must not be able to fill it in.
        expect(queryByText("Email")).toBeNull();
        expect(queryByText("Send invite")).toBeNull();
    });

    it("renders the seat-limit panel with no CTA when billingUrl is omitted (no billing portal configured)", () => {
        const { getByText, queryByText } = render(
            <InviteSeatDrawer open onClose={() => {}} seatLimitAtOpen={{ used: 3, max: 3 }} />,
        );
        expect(getByText(/Seat limit reached/)).toBeTruthy();
        expect(queryByText("Upgrade")).toBeNull();
    });

    it("renders the normal invite form when under the seat limit (seatLimitAtOpen undefined)", () => {
        const { getByText, queryByText } = render(
            <InviteSeatDrawer open onClose={() => {}} seatLimitAtOpen={undefined} />,
        );
        expect(queryByText(/Seat limit reached/)).toBeNull();
        expect(getByText("Email")).toBeTruthy();
        expect(getByText("Send invite")).toBeTruthy();
    });

    it("renders the normal invite form when the prop is omitted entirely (unlimited / other mounts)", () => {
        const { getByText, queryByText } = render(<InviteSeatDrawer open onClose={() => {}} />);
        expect(queryByText(/Seat limit reached/)).toBeNull();
        expect(getByText("Email")).toBeTruthy();
    });
});

describe("InviteSeatDrawer in-flight latch", () => {
    const fetcherState = { state: "idle" as "idle" | "submitting", submit: vi.fn() };

    function ui() {
        return <InviteSeatDrawer open onClose={() => {}} />;
    }

    function form(): HTMLFormElement {
        const f = document.getElementById("invite-seat-form");
        if (!(f instanceof HTMLFormElement)) throw new Error("form not rendered");
        return f;
    }

    beforeEach(() => {
        fetcherState.state = "idle";
        fetcherState.submit.mockReset();
        vi.mocked(useFetcher).mockImplementation(
            () => ({ state: fetcherState.state, data: undefined, submit: fetcherState.submit, load: vi.fn() }) as unknown as ReturnType<typeof useFetcher>,
        );
    });
    afterEach(cleanup);

    it("submits once when two submits land in one frame", () => {
        render(ui());
        const f = form();
        act(() => { f.requestSubmit(); f.requestSubmit(); });
        expect(fetcherState.submit).toHaveBeenCalledTimes(1);
    });

    it("releases when the fetcher returns to idle so a failed invite can be retried", () => {
        const { rerender } = render(ui());
        act(() => { form().requestSubmit(); form().requestSubmit(); });
        expect(fetcherState.submit).toHaveBeenCalledTimes(1);
        fetcherState.state = "submitting";
        rerender(ui());
        fetcherState.state = "idle";
        rerender(ui());
        act(() => { form().requestSubmit(); });
        expect(fetcherState.submit).toHaveBeenCalledTimes(2);
    });
});
