// @vitest-environment happy-dom
/**
 * The review that has to happen before model-assisted text becomes a finding
 * (#61).
 *
 * What is pinned here is NOT "the panel renders". It is the three things whose
 * failure is silent — a report goes out containing model-assisted prose and
 * nothing anywhere says whether a person ever read it:
 *
 *   - A draft NEVER reaches the note on arrival. It sits beside the
 *     inspector's own words until they act.
 *   - If recording the review FAILS, the note is not changed. Text-in,
 *     evidence-maybe is the exact state this feature exists to end, and it is
 *     the behaviour a "simplify the happy path" refactor removes first.
 *   - With no artifact to cite, nothing is offered at all. A review recorded
 *     against no artifact is not evidence of anything.
 *
 * ⚠️ THE CONTROLS MATTER AS MUCH AS THE CASES. "onAccept was not called" is
 * satisfied for free by a panel that does nothing whatsoever, so every negative
 * is paired with a positive that MUST call it — and the review request is read
 * back to confirm it carried the `aiCallId` the assist response returned, not
 * some other string. A review citing the wrong call is worse than none: it
 * looks like evidence.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import { AiAssistPanel } from "./AiAssistPanel";

const DRAFT = "The roof covering shows significant granule loss at the south slope.";
const CALL_ID = "ai-call-1";
const RESULT_ID = "result-1";

function renderPanel(opts: { resultId?: string | null; reviewFails?: boolean } = {}) {
    const submitted: Record<string, string>[] = [];
    const onAccept = vi.fn();

    const Stub = createRoutesStub([
        {
            path: "/",
            Component: () => (
                <AiAssistPanel
                    notes="roof bad, lots of granules gone south side"
                    context="Roof — Roof Covering"
                    resultId={opts.resultId === undefined ? RESULT_ID : opts.resultId}
                    onAccept={onAccept}
                />
            ),
        },
        {
            path: "/resources/ai-assist",
            action: async ({ request }) => {
                const form = Object.fromEntries(await request.formData()) as Record<string, string>;
                submitted.push(form);
                if (form.intent === "assist") {
                    return { ok: true, intent: "assist", text: DRAFT, aiCallId: CALL_ID };
                }
                if (opts.reviewFails) {
                    return { ok: false, error: "AI writing assistance is unavailable right now." };
                }
                return { ok: true, intent: "review" };
            },
        },
    ]);

    render(<Stub initialEntries={["/"]} />);
    return { submitted, onAccept };
}

const improve = () => screen.getByRole("button", { name: /improve wording/i });
const useBtn = () => screen.getByRole("button", { name: /use reviewed text/i });

async function getDraft() {
    fireEvent.click(improve());
    await screen.findByText(DRAFT);
}

describe("AiAssistPanel — review before the text becomes a finding", () => {
    it("does not offer assistance when there is no artifact to cite", () => {
        renderPanel({ resultId: null });
        // CONTROL is the case below: with an artifact the trigger IS present,
        // so this assertion is about the null, not about the query being wrong.
        expect(screen.queryByRole("button", { name: /improve wording/i })).toBeNull();
    });

    it("CONTROL — with an artifact the trigger is offered", () => {
        renderPanel();
        expect(improve()).toBeTruthy();
    });

    it("shows the draft without putting it in the note", async () => {
        const { onAccept } = renderPanel();
        await getDraft();
        expect(onAccept).not.toHaveBeenCalled();
    });

    it("will not record a review the inspector has not stated", async () => {
        renderPanel();
        await getDraft();
        expect(useBtn()).toBeDisabled();
    });

    it("records the review, citing the call that produced the text, and only then writes the note", async () => {
        const { submitted, onAccept } = renderPanel();
        await getDraft();
        fireEvent.click(screen.getByLabelText(/i reviewed this text/i));
        fireEvent.click(useBtn());

        await waitFor(() => expect(onAccept).toHaveBeenCalledWith(DRAFT));
        const review = submitted.find((s) => s.intent === "review");
        expect(review).toMatchObject({
            intent: "review",
            artifactId: RESULT_ID,
            // The id from the assist response — not a placeholder, not the
            // artifact id repeated. A review citing the wrong call reads as
            // evidence and is not.
            aiCallId: CALL_ID,
        });
    });

    it("FAIL CLOSED — a review that cannot be recorded leaves the note alone", async () => {
        const { onAccept } = renderPanel({ reviewFails: true });
        await getDraft();
        fireEvent.click(screen.getByLabelText(/i reviewed this text/i));
        fireEvent.click(useBtn());

        await screen.findByText(/unavailable right now/i);
        expect(onAccept).not.toHaveBeenCalled();
        // The draft survives so the attempt can be retried; losing it would
        // spend another AI call to get back to the same place.
        expect(screen.getByText(DRAFT)).toBeTruthy();
        expect(screen.getByText(/note was not changed/i)).toBeTruthy();
    });

    it("discards the draft without recording anything", async () => {
        const { submitted, onAccept } = renderPanel();
        await getDraft();
        fireEvent.click(screen.getByRole("button", { name: /discard/i }));

        await waitFor(() => expect(screen.queryByText(DRAFT)).toBeNull());
        expect(onAccept).not.toHaveBeenCalled();
        expect(submitted.some((s) => s.intent === "review")).toBe(false);
    });
});
