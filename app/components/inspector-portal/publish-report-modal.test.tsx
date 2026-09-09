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
