// @vitest-environment happy-dom
/**
 * The AI assurance record, as a reader sees it.
 *
 * The panel has one job that matters and several that only look like jobs.
 * Rendering the model and prompt version is table stakes — those are facts, and
 * a table that showed them and nothing else would still leave the question this
 * whole surface exists for unanswered. The job is making an UNREVIEWED call
 * impossible to scroll past, because "a model wrote this and nobody looked at
 * it" is the only row state that carries professional liability.
 *
 * So the assertions come in pairs, and the silence half is not padding: a panel
 * that always shouted would be decoration people learn to ignore, and a panel
 * that never shouted would be the write-only ledger this replaced.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import {
    AiAssurancePanel,
    type AiAssuranceInitial,
    type AiAssuranceRow,
    type AiReviewRow,
} from "~/components/settings/AiAssurancePanel";

const CALL_AT = Date.UTC(2026, 7, 12, 9, 30);
const REVIEW_AT = Date.UTC(2026, 7, 12, 9, 45);

/**
 * Typed against the panel's own row contract rather than inlined, so a field
 * added to `AiReviewRow` fails here instead of rendering as a blank cell.
 */
function review(overrides: Partial<AiReviewRow> = {}): AiReviewRow {
    return {
        id: "r1",
        artifactType: "inspection_result",
        artifactId: "a1",
        reviewedBy: "u1",
        reviewerName: "Dana Reviewer",
        reviewedAt: REVIEW_AT,
        ...overrides,
    };
}

function base(overrides: Partial<AiAssuranceInitial> = {}): AiAssuranceInitial {
    return {
        calls: [],
        unresolvedReviewCount: 0,
        nextBefore: null,
        activeBefore: null,
        ...overrides,
    };
}

function reviewedCall(): AiAssuranceRow {
    return {
        id: "c1",
        capability: "assist",
        provider: "gemini",
        mode: "byo",
        model: "gemini-2.5-flash",
        promptVersion: "professional-comment.v1",
        calledAt: CALL_AT,
        reviews: [review()],
    };
}

function unreviewedCall(): AiAssuranceRow {
    return { ...reviewedCall(), id: "c2", reviews: [] };
}

/** The panel renders <Link>, so it needs a router context. */
function renderPanel(initial: AiAssuranceInitial) {
    const Stub = createRoutesStub([
        { path: "/", Component: () => <AiAssurancePanel initial={initial} /> },
    ]);
    return render(<Stub initialEntries={["/"]} />);
}

describe("AiAssurancePanel", () => {
    it("says nothing was drafted with AI when the ledger itself is empty", () => {
        renderPanel(base());
        expect(screen.getByText(/no ai calls recorded/i)).toBeTruthy();
        expect(screen.queryByRole("table")).toBeNull();
    });

    it("does not claim the ledger is empty when the reader has simply paged past its end", () => {
        // Same zero rows, different fact. "Nothing has been drafted with model
        // assistance" is false on page four, and the reader has no way to tell.
        renderPanel(base({ activeBefore: 1234 }));
        expect(screen.getByText(/no calls older than this point/i)).toBeTruthy();
        expect(screen.queryByText(/no ai calls recorded/i)).toBeNull();
    });

    it("shows the model and prompt version that produced the text", () => {
        renderPanel(base({ calls: [reviewedCall()] }));
        expect(screen.getByText("gemini-2.5-flash")).toBeTruthy();
        expect(screen.getByText("professional-comment.v1")).toBeTruthy();
    });

    it("names the reviewer and when they reviewed it", () => {
        renderPanel(base({ calls: [reviewedCall()] }));
        expect(screen.getByText("Dana Reviewer")).toBeTruthy();
        expect(screen.queryByText(/not reviewed/i)).toBeNull();
    });

    it("marks a call nobody reviewed, and counts it above the table", () => {
        renderPanel(base({ calls: [reviewedCall(), unreviewedCall()] }));
        expect(screen.getByText(/not reviewed/i)).toBeTruthy();
        expect(screen.getByText(/no recorded review for 1 of the 2 calls shown/i)).toBeTruthy();
    });

    it("stays silent about unreviewed calls when every call was reviewed", () => {
        renderPanel(base({ calls: [reviewedCall()] }));
        expect(screen.queryByText(/no recorded review/i)).toBeNull();
    });

    it("falls back to the reviewer id when the user row is gone", () => {
        const call = reviewedCall();
        call.reviews[0].reviewerName = null;
        renderPanel(base({ calls: [call] }));
        expect(screen.getByText("u1")).toBeTruthy();
    });

    it("reports reviews that cite a call this workspace has no record of", () => {
        renderPanel(base({ calls: [reviewedCall()], unresolvedReviewCount: 3 }));
        expect(screen.getByText(/reviews citing a call this workspace has no record of: 3/i)).toBeTruthy();
    });

    it("stays silent when every review resolves", () => {
        renderPanel(base({ calls: [reviewedCall()] }));
        expect(screen.queryByText(/no record of/i)).toBeNull();
    });

    it("offers the older page as a shareable URL rather than a client-side fetch", () => {
        renderPanel(base({ calls: [reviewedCall()], nextBefore: 1234 }));
        const link = screen.getByRole("link", { name: /show older calls/i });
        expect(link.getAttribute("href")).toContain("aiBefore=1234");
    });

    it("offers a way back to the newest page only while a cursor is active", () => {
        renderPanel(base({ calls: [reviewedCall()], activeBefore: 1234 }));
        expect(screen.getByRole("link", { name: /back to latest/i })).toBeTruthy();

        renderPanel(base({ calls: [reviewedCall()] }));
        expect(screen.queryAllByRole("link", { name: /back to latest/i })).toHaveLength(1);
    });

    it("names the credential source in the reader’s words, not the column’s", () => {
        renderPanel(base({ calls: [{ ...reviewedCall(), mode: "managed" }] }));
        expect(screen.getByText(/platform key/i)).toBeTruthy();
        expect(screen.queryByText("managed")).toBeNull();
    });
});
