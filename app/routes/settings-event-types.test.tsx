// @vitest-environment happy-dom
/**
 * `event_types.follow_up_delay_hours` shipped with no way for a human to set it:
 * the column and both CRUD schemas existed, and this page — the only screen that
 * edits an event type — did not offer the field. These tests hold the three
 * things that make the control correct rather than merely present.
 *
 * ZERO IS A LEGITIMATE VALUE ("the results exist when the camera comes out"), so
 * the two failure modes worth guarding are symmetrical: a read that treats 0 as
 * unset, and a write that treats "untouched" as 0.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import SettingsEventTypes from "~/routes/settings-event-types";

const TYPE = {
    id: "et1",
    name: "Sewer scope",
    slug: "sewer_scope",
    defaultDurationMin: 45,
    defaultPriceCents: 15000,
    color: "#4a72ff",
    sortOrder: 0,
    active: true,
    followUpDelayHours: 72,
};

function renderPage(types: Array<Record<string, unknown>>) {
    const Stub = createRoutesStub([
        {
            path: "/settings/event-types",
            Component: SettingsEventTypes,
            loader: () => ({ types, loadFailed: false }),
        },
    ]);
    return render(<Stub initialEntries={["/settings/event-types"]} />);
}

/** The PATCH body the page last sent, parsed. */
function lastPatchBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
    const call = fetchMock.mock.calls.at(-1);
    return JSON.parse(String((call?.[1] as RequestInit).body));
}

describe("settings → event types: follow-up delay", () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = vi.fn(async () => ({
            ok: true,
            json: async () => ({ data: TYPE }),
        })) as unknown as ReturnType<typeof vi.fn>;
        vi.stubGlobal("fetch", fetchMock);
    });
    afterEach(() => vi.unstubAllGlobals());

    it("shows the configured delay in the list", async () => {
        renderPage([TYPE]);
        expect((await screen.findByTestId("event-type-followup")).textContent).toContain("72");
    });

    it("reads zero as immediately, not as unset", async () => {
        // `||` passes the 72-hour case and fails exactly here.
        renderPage([{ ...TYPE, followUpDelayHours: 0 }]);
        const cell = await screen.findByTestId("event-type-followup");
        expect(cell.textContent).not.toContain("0 h");
        expect(cell.textContent).toContain("Immediately");
    });

    it("seeds the edit form from the stored value", async () => {
        renderPage([{ ...TYPE, followUpDelayHours: 0 }]);
        fireEvent.click(await screen.findByRole("button", { name: /edit/i }));
        expect((await screen.findByTestId("event-type-followup-input") as HTMLInputElement).value)
            .toBe("0");
    });

    it("sends zero when zero is typed", async () => {
        renderPage([TYPE]);
        fireEvent.click(await screen.findByRole("button", { name: /edit/i }));
        fireEvent.change(await screen.findByTestId("event-type-followup-input"), {
            target: { value: "0" },
        });
        fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
        await waitFor(() => expect(fetchMock).toHaveBeenCalled());
        expect(lastPatchBody(fetchMock).followUpDelayHours).toBe(0);
    });

    it("omits the field when the box is emptied, rather than sending 0", async () => {
        // The PUT schema is a `.partial()`: an absent key leaves the stored delay
        // alone, a 0 rewrites it to "immediately". "I did not touch that" must
        // not be transmitted as the most aggressive setting available.
        renderPage([TYPE]);
        fireEvent.click(await screen.findByRole("button", { name: /edit/i }));
        fireEvent.change(await screen.findByTestId("event-type-followup-input"), {
            target: { value: "" },
        });
        fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
        await waitFor(() => expect(fetchMock).toHaveBeenCalled());
        expect(lastPatchBody(fetchMock)).not.toHaveProperty("followUpDelayHours");
    });
});
