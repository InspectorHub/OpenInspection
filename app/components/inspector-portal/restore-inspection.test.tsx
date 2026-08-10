// @vitest-environment happy-dom
/**
 * #81 — the hub's cancelled state has a way out, and it does not lie about money.
 *
 * The gap this closes: cancelling happens HERE, on the Lifecycle card, behind a
 * priced confirmation. Recovery lived on the `/inspections` list row's
 * hover-only status dropdown, a page away, with nothing on the cancelled card
 * pointing at it — so the one surface that takes the mis-click was the one
 * surface with no way to undo it.
 *
 * WHAT IS PINNED:
 *
 *   1. THE CONTROL EXISTS IN THE CANCELLED STATE — and only there. A Restore
 *      button on a scheduled inspection reads as a claim that something went
 *      wrong with it (the positive control below).
 *   2. THE CONFIRMATION NAMES BOTH HALVES. Un-cancelling is NOT an undo: the
 *      inspection returns to scheduled, and the fee kept plus the refund
 *      issued are ledger entries that already happened. Copy promising a clean
 *      reversal would be the comfortable sentence and the false one, so the
 *      assertion is on the money half specifically — that is the half a
 *      well-meaning rewrite drops.
 *   3. NOTHING IS WRITTEN UNTIL THE CONFIRMATION IS ACCEPTED, and the write
 *      goes to the BFF resource route. A client `fetch('/api/...')` here would
 *      arrive unauthenticated.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { createRoutesStub, useFetcher, useLoaderData } from "react-router";

import { LifecycleCard } from "~/components/inspector-portal/LifecycleCard";
import { INSPECTION_STATUS } from "~/lib/status";

interface Harness {
    /** Restore submissions, as the raw form fields. */
    submitted: Record<string, string>[];
}

function renderCard(status: string, restoreResult: unknown = { ok: true }): Harness {
    const harness: Harness = { submitted: [] };

    const Stub = createRoutesStub([
        {
            path: "/hub",
            loader: async () => ({ revalidatedAt: performance.now() }),
            HydrateFallback: () => <div />,
            Component: () => <CardHost status={status} />,
            action: async () => ({ ok: true }),
        },
        {
            path: "/resources/inspection-restore",
            action: async ({ request }) => {
                const form = await request.formData();
                harness.submitted.push(Object.fromEntries(form) as Record<string, string>);
                return restoreResult;
            },
        },
    ]);

    render(<Stub initialEntries={["/hub"]} />);
    return harness;
}

function CardHost({ status }: { status: string }) {
    useLoaderData();
    return <LifecycleCard status={status} inspectionId="insp-1" fetcher={useFetcher()} />;
}

const restoreButton = () => screen.findByRole("button", { name: "Restore to scheduled" });

/**
 * The dialog's confirm carries the SAME label as the trigger, deliberately: a
 * confirmation whose button renames the action makes the reader re-decide what
 * they are agreeing to. Scoping by the dialog is how the two stay tellable
 * apart here.
 */
const confirmInDialog = async () =>
    within(await screen.findByRole("dialog")).getByRole("button", { name: "Restore to scheduled" });

beforeEach(() => {
    document.body.innerHTML = "";
});

describe("recovering a cancelled inspection from the hub", () => {
    it("offers the control on a cancelled inspection", async () => {
        renderCard(INSPECTION_STATUS.CANCELLED);
        expect(await restoreButton()).toBeTruthy();
    });

    it("says where recovery lives without pretending the money comes back", async () => {
        renderCard(INSPECTION_STATUS.CANCELLED);
        await restoreButton();
        expect(screen.getByText(/Cancelled by mistake\?/)).toBeTruthy();
        expect(screen.getByText(/fee or refund stays as recorded/)).toBeTruthy();
    });

    it("POSITIVE CONTROL — an active inspection is offered no recovery", async () => {
        renderCard(INSPECTION_STATUS.SCHEDULED);
        // Wait for the card to hydrate before concluding the button is absent,
        // or this passes against a page that simply has not rendered yet.
        expect(await screen.findByRole("button", { name: "Cancel inspection" })).toBeTruthy();
        expect(screen.queryByRole("button", { name: "Restore to scheduled" })).toBeNull();
    });

    it("POSITIVE CONTROL — a completed inspection is offered no recovery either", async () => {
        renderCard(INSPECTION_STATUS.COMPLETED);
        expect(await screen.findByText(/on-site work is finished/)).toBeTruthy();
        expect(screen.queryByRole("button", { name: "Restore to scheduled" })).toBeNull();
    });

    it("writes nothing until the confirmation is accepted", async () => {
        const harness = renderCard(INSPECTION_STATUS.CANCELLED);
        fireEvent.click(await restoreButton());

        expect(await screen.findByText(/Put this inspection back on the schedule\?/)).toBeTruthy();
        expect(harness.submitted).toEqual([]);
    });

    it("names what changes AND what does not, in the confirmation", async () => {
        renderCard(INSPECTION_STATUS.CANCELLED);
        fireEvent.click(await restoreButton());

        const body = await screen.findByText(/returns to Scheduled/);
        // The half that must never be dropped. "Restore" reads as "undo", and
        // the fee and the refund are already in the ledger.
        expect(body.textContent).toMatch(/does not reverse them/);
        expect(body.textContent).toMatch(/payment ledger/);
        expect(body.textContent).toMatch(/cancellation reason is cleared/);
    });

    it("submits to the BFF resource route, not to the API", async () => {
        const harness = renderCard(INSPECTION_STATUS.CANCELLED);
        fireEvent.click(await restoreButton());
        fireEvent.click(await confirmInDialog());

        await waitFor(() => expect(harness.submitted).toEqual([{ id: "insp-1" }]));
    });

    it("shows the API's refusal beside the control rather than swallowing it", async () => {
        renderCard(INSPECTION_STATUS.CANCELLED, {
            ok: false,
            error: "This inspection is not cancelled.",
        });
        fireEvent.click(await restoreButton());
        fireEvent.click(await confirmInDialog());

        expect(await screen.findByRole("alert")).toHaveProperty(
            "textContent", "This inspection is not cancelled.",
        );
    });
});
