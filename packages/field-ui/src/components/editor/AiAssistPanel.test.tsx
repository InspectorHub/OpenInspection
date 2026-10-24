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
 *
 * The panel runs on the data source's `aiAssist` resource, so these tests put a
 * fake one behind the provider and assert on the REQUESTS it received. What the
 * web host posts for those requests is pinned in app/lib/field/web-ai-assist.test.ts.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, cleanup } from "@testing-library/react";
import { FieldDataSourceProvider } from "../../context";
import {
    createEmptyEditorData,
    createFakeAiAssist,
    createFakeDataSource,
} from "../../testing/fake-data-source";
import type { FakeAiAssist } from "../../testing/fake-data-source";
import { AiAssistPanel } from "./AiAssistPanel";

afterEach(cleanup);

const DRAFT = "The roof covering shows significant granule loss at the south slope.";
const CALL_ID = "ai-call-1";
const RESULT_ID = "result-1";
const UNAVAILABLE = "AI writing assistance is unavailable right now.";

function renderPanel(opts: { resultId?: string | null; reviewFails?: boolean; noResource?: boolean } = {}) {
    const ai: FakeAiAssist = createFakeAiAssist();
    ai.answerAssist({ ok: true, intent: "assist", text: DRAFT, aiCallId: CALL_ID });
    if (opts.reviewFails) ai.answerReview({ ok: false, error: UNAVAILABLE });
    const onAccept = vi.fn();
    const ds = createFakeDataSource({
        data: createEmptyEditorData(),
        resources: opts.noResource ? {} : { aiAssist: ai },
    });
    render(
        <FieldDataSourceProvider dataSource={ds}>
            <AiAssistPanel
                notes="roof bad, lots of granules gone south side"
                context="Roof — Roof Covering"
                resultId={opts.resultId === undefined ? RESULT_ID : opts.resultId}
                onAccept={onAccept}
            />
        </FieldDataSourceProvider>,
    );
    return { ai, onAccept };
}

const improve = () => screen.getByRole("button", { name: /improve wording/i });
const useBtn = () => screen.getByRole("button", { name: /use reviewed text/i });
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });

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

    it("does not offer assistance when the host has no AI resource", () => {
        renderPanel({ noResource: true });
        expect(screen.queryByRole("button", { name: /improve wording/i })).toBeNull();
    });

    it("CONTROL — with an artifact the trigger is offered", () => {
        renderPanel();
        expect(improve()).toBeTruthy();
    });

    it("asks for the rewrite with the note and the item context", async () => {
        const { ai } = renderPanel();
        await getDraft();
        expect(ai.runs).toEqual([
            {
                intent: "assist",
                payload: { text: "roof bad, lots of granules gone south side", context: "Roof — Roof Covering" },
            },
        ]);
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
        const { ai, onAccept } = renderPanel();
        await getDraft();
        fireEvent.click(screen.getByLabelText(/i reviewed this text/i));
        fireEvent.click(useBtn());

        await waitFor(() => expect(onAccept).toHaveBeenCalledWith(DRAFT));
        const review = ai.runs.find((r) => r.intent === "review");
        expect(review).toEqual({
            intent: "review",
            payload: {
                artifactId: RESULT_ID,
                // The id from the assist response — not a placeholder, not the
                // artifact id repeated. A review citing the wrong call reads as
                // evidence and is not.
                aiCallId: CALL_ID,
            },
        });
        // The draft is gone once it has become the note.
        await waitFor(() => expect(screen.queryByText(DRAFT)).toBeNull());
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

    it("a refused assist shows the host's sentence and offers the trigger again", async () => {
        const { ai } = renderPanel();
        ai.answerAssist({ ok: false, error: "Your plan does not include AI." });
        fireEvent.click(improve());
        expect(await screen.findByText("Your plan does not include AI.")).toBeTruthy();
        expect(improve()).toBeTruthy();
    });

    it("discards the draft without recording anything", async () => {
        const { ai, onAccept } = renderPanel();
        await getDraft();
        fireEvent.click(screen.getByRole("button", { name: /discard/i }));

        await waitFor(() => expect(screen.queryByText(DRAFT)).toBeNull());
        expect(onAccept).not.toHaveBeenCalled();
        expect(ai.runs.some((r) => r.intent === "review")).toBe(false);
    });
});

// `assist` spends a metered AI call and `review` writes the record that lets text into the note, so
// two clicks in ONE frame must send ONE request. `busy` only renders a frame later.
describe("AiAssistPanel — same-frame guard", () => {
    it("asks for ONE rewrite for two same-frame clicks", async () => {
        const { ai } = renderPanel();
        act(() => { improve().click(); improve().click(); });
        await settle();
        expect(ai.runs.filter((r) => r.intent === "assist")).toHaveLength(1);
    });

    it("CONTROL — a later click goes through once the first has settled", async () => {
        const { ai } = renderPanel();
        act(() => { improve().click(); });
        await screen.findByText(DRAFT);
        // Discard, then ask again: a second request is allowed after the first one is over.
        fireEvent.click(screen.getByRole("button", { name: /discard/i }));
        await waitFor(() => expect(screen.queryByText(DRAFT)).toBeNull());
        act(() => { improve().click(); });
        await screen.findByText(DRAFT);
        expect(ai.runs.filter((r) => r.intent === "assist")).toHaveLength(2);
    });

    it("records the review ONCE for two same-frame clicks and writes the note once", async () => {
        const { ai, onAccept } = renderPanel();
        await getDraft();
        fireEvent.click(screen.getByLabelText(/i reviewed this text/i));
        const btn = useBtn();
        act(() => { btn.click(); btn.click(); });
        await settle();
        expect(ai.runs.filter((r) => r.intent === "review")).toHaveLength(1);
        expect(onAccept).toHaveBeenCalledTimes(1);
    });

    it("a review in flight shows as recording and a later click sends nothing more", async () => {
        const { ai } = renderPanel();
        await getDraft();
        fireEvent.click(screen.getByLabelText(/i reviewed this text/i));
        const release = ai.hold();
        act(() => { useBtn().click(); });
        const recording = screen.getByRole("button", { name: /recording your review/i });
        act(() => { recording.click(); });
        expect(ai.runs.filter((r) => r.intent === "review")).toHaveLength(1);
        release();
        await settle();
    });
});
