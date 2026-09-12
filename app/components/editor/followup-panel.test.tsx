/**
 * @vitest-environment happy-dom
 *
 * F45 — the inspector has to SEE the baseline finding and be able to answer it.
 *
 * Measured before this panel existed: opening a re-inspection's carried item
 * showed the ordinary item panel — ratings, notes, canned comments, photos — and
 * the words "original", "previous", "baseline" and "follow-up" appeared nowhere
 * on the page. `followupStatus` had 1 reference in all of `app/**` (a field
 * whitelist), `isCarried` and `carriedItems` had 0. So the inspector could not
 * see that this item was called a Defect last time and had nowhere to record
 * whether it had been fixed.
 *
 * The discriminating assertions are the two that read the baseline rating and
 * operate the verdict control: a test that only asserted "renders nothing for an
 * ordinary item" passed before the panel existed, because nothing rendered for
 * ANY item.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

// Typed by its PARAMETERS, not just its return. `vi.fn(() => true)` infers a
// zero-argument signature, so `mock.calls[0][0]` is a tuple index that does not
// exist and the assertions below cannot be written at all.
const submit = vi.fn((_payload: Record<string, unknown>, _opts?: unknown) => true);
const fetcherData: { current: unknown } = { current: undefined };

vi.mock("~/hooks/useGuardedSubmit", () => ({
    useGuardedSubmit: () => ({
        submit,
        fetcher: { state: "idle", data: fetcherData.current },
        busy: false,
        idempotencyKey: "k",
    }),
}));

import { FollowupPanel } from "./FollowupPanel";

const CARRIED = {
    original: { rating: "Defect", notes: "Cracked crown", photos: [{ key: "a" }, { key: "b" }] },
    followupStatus: null,
};

beforeEach(() => {
    vi.clearAllMocks();
    fetcherData.current = undefined;
});

describe("FollowupPanel", () => {
    it("shows the baseline finding the round was created from", () => {
        render(<FollowupPanel itemId="chimney" result={CARRIED} />);
        expect(screen.getByText("Original finding")).toBeInTheDocument();
        expect(screen.getByText("Defect")).toBeInTheDocument();
        expect(screen.getByText(/Cracked crown/)).toBeInTheDocument();
        expect(screen.getByText("2 photos from the original inspection")).toBeInTheDocument();
    });

    it("says out loud that no verdict has been recorded yet", () => {
        render(<FollowupPanel itemId="chimney" result={CARRIED} />);
        expect(screen.getByText(/No verdict recorded yet/)).toBeInTheDocument();
    });

    it("records the verdict through the editor route's intent", () => {
        render(<FollowupPanel itemId="chimney" result={CARRIED} />);
        fireEvent.click(screen.getByRole("radio", { name: "Resolved" }));
        expect(submit).toHaveBeenCalledTimes(1);
        expect(submit.mock.calls[0]![0]).toEqual({
            intent: "set-followup",
            itemId: "chimney",
            status: "resolved",
        });
        // No `notes` key — absent means "leave the note alone", so recording a
        // verdict cannot wipe a note the inspector already wrote.
        expect(Object.keys(submit.mock.calls[0]![0])).not.toContain("notes");
    });

    it("reflects a verdict already in the document, and stops nagging about it", () => {
        render(<FollowupPanel itemId="chimney" result={{ ...CARRIED, followupStatus: "resolved" }} />);
        expect(screen.getByRole("radio", { name: "Resolved" })).toHaveAttribute("aria-checked", "true");
        expect(screen.queryByText(/No verdict recorded yet/)).toBeNull();
    });

    it("relays the server's sentence when the write is refused", () => {
        fetcherData.current = { ok: false, intent: "set-followup", error: "unknown follow-up status" };
        render(<FollowupPanel itemId="chimney" result={CARRIED} />);
        expect(screen.getByText("unknown follow-up status")).toBeInTheDocument();
    });

    it("renders NOTHING for an ordinary item with no baseline", () => {
        // An empty "previous round" frame on a normal inspection would promise a
        // baseline there is none of.
        const { container } = render(<FollowupPanel itemId="chimney" result={{ rating: "Satisfactory" }} />);
        expect(container.querySelector("[data-testid='followup-panel']")).toBeNull();
    });
});
