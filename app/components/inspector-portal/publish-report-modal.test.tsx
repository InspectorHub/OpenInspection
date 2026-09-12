// @vitest-environment happy-dom
/**
 * The publish modal tells the inspector what is unresolved — and still lets
 * them publish.
 *
 * WHY BOTH HALVES ARE THE FEATURE:
 *
 *   1. IT SAYS SOMETHING. The hub card next to the Publish button counts
 *      unresolved items, but the modal that actually publishes said nothing
 *      about them, so the last screen before the irreversible act was the one
 *      screen with the least information. Publishing from the editor showed a
 *      list; publishing from the hub showed nothing. Same act, two answers.
 *   2. IT DOES NOT BLOCK. Surveyed 2026-09-07: of five established products,
 *      four never block publishing on report completeness (HomeGauge warns with
 *      a one-click override, ISN and Horizon only count, Palmtech checks the
 *      agreement and never the content), and the one that does — Spectora —
 *      ships it off by default. Horizon's own tutorial is explicit: "Required
 *      Items will not force you to make an entry. It is simply a gentle
 *      reminder." A disabled publish button here would be the outlier.
 *
 * The count is all the hub has: its payload carries `{ ready, blockingCount }`
 * and not the defects themselves — those come from a separate endpoint the
 * editor calls. Listing them here would be a server change, not a copy change.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { createRoutesStub, useFetcher } from "react-router";

import { PublishReportModal } from "~/components/inspector-portal/PublishReportModal";

function renderModal(blockingCount: number) {
    const Stub = createRoutesStub([
        {
            path: "/",
            Component() {
                const fetcher = useFetcher();
                return (
                    <PublishReportModal
                        open
                        agreementRequired={false}
                        paymentRequired={false}
                        isAmendment={false}
                        courtesyTranslationEnabled={false}
                        courtesyTranslationLocale="es-419"
                        clientPrefersTranslation={false}
                        blockingCount={blockingCount}
                        fetcher={fetcher as never}
                        submitting={false}
                        error={undefined}
                        onClose={() => {}}
                    />
                );
            },
        },
    ]);
    render(<Stub initialEntries={["/"]} />);
}

describe("PublishReportModal unresolved-items notice", () => {
    it("names the unresolved count on the screen that publishes", () => {
        renderModal(2);
        expect(screen.getByText(/2\s+item/i)).toBeTruthy();
    });

    it("leaves the publish button usable — a warning, not a gate", () => {
        renderModal(2);
        const publish = screen.getByRole("button", { name: /publish/i });
        expect((publish as HTMLButtonElement).disabled).toBe(false);
    });

    // POSITIVE CONTROL for the first assertion: with nothing unresolved the
    // notice must be absent. Without this, a modal that rendered the notice
    // unconditionally — or one whose count never reached it — would pass.
    it("says nothing when there is nothing unresolved", () => {
        renderModal(0);
        expect(screen.queryByText(/item\(s\)|items? still need attention/i)).toBeNull();
    });
});

/**
 * F79 — the modal offers no "who gets notified" switches, because nothing honours
 * them.
 *
 * It used to render `notifyClient` and `notifyAgent`. `publishInspection` declares
 * both in its options type and reads neither: who receives the report is decided
 * by the workspace's `report.published` automation rules. So the switches changed
 * nothing, and the publish audit entry recorded the flag as given — a publish
 * marked "notify nobody" was written down as one that notified nobody while every
 * rule fired and the mail went out.
 *
 * Removing them without answering the question they asked would be a second
 * defect, so the dialog now STATES who will be told and points at the surface
 * that decides it. That sentence is asserted here alongside the absence: a modal
 * that dropped the switches and said nothing would otherwise pass.
 *
 * The two remaining toggles are the positive control. They prove the harness
 * renders toggle rows at all, so "no notify checkbox" means absent rather than
 * unrendered.
 */
describe("PublishReportModal — no notify switches (F79)", () => {
    it("renders no notify-client / notify-agent control", async () => {
        renderModal(0);
        // The wire names, which is what the action used to read off the form.
        expect(await screen.findByRole("button", { name: /publish/i })).toBeTruthy();
        expect(document.querySelector('input[name="notifyClient"]')).toBeNull();
        expect(document.querySelector('input[name="notifyAgent"]')).toBeNull();
        // And the user-visible promise, whatever it happened to be labelled.
        expect(screen.queryByRole("checkbox", { name: /notify/i })).toBeNull();
    });

    it("states who will be notified, and points at what decides it", async () => {
        renderModal(0);
        expect(await screen.findByTestId("publish-notify-automation")).toBeTruthy();
        const link = await screen.findByRole("link", { name: /automation/i });
        expect(link.getAttribute("href")).toBe("/settings/automations");
    });

    // POSITIVE CONTROL: the gate toggles are still switches on this form, so the
    // absence assertions above are about these two flags and not about a modal
    // that renders no checkboxes at all.
    it("still offers the two gates the server does honour", async () => {
        renderModal(0);
        expect(await screen.findByRole("checkbox", { name: /signature/i })).toBeTruthy();
        expect(await screen.findByRole("checkbox", { name: /payment/i })).toBeTruthy();
    });
});
