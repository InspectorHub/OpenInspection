// @vitest-environment happy-dom
/**
 * #67 — the cancellation flow, from the hub's lifecycle card.
 *
 * WHAT IS PINNED, and why each one is the feature rather than decoration:
 *
 *   1. THE QUOTE COMES FIRST. The confirm is unreachable until the priced
 *      outcome has been fetched and rendered. A flow that lets someone cancel
 *      before the fee appears defeats the entire policy ladder — the ladder
 *      exists so the person cancelling sees what it costs.
 *   2. THE REASON RE-PRICES. A no-show and a weather cancellation are different
 *      rungs, so changing the reason must re-ask rather than keep the figure
 *      from the previous one on screen.
 *   3. THE CONFIRMATION NAMES THE MONEY. Not "are you sure?" — the fee kept,
 *      the amount refunded, and that neither is reversible from this page.
 *   4. THE ACKNOWLEDGED FEE IS THE FEE THAT WAS SHOWN. The API refuses to charge
 *      a fee the caller has not echoed back, so a submit carrying a different
 *      number (or none) is the failure this assertion exists to catch.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { createRoutesStub, useFetcher, useLoaderData } from "react-router";

import { LifecycleCard } from "~/components/inspector-portal/LifecycleCard";
import { INSPECTION_STATUS } from "~/lib/status";

const QUOTE = {
    feeCents: 12500,
    refundCents: 37500,
    reason: "late_cancellation",
    cappedAtCollected: false,
    priceCents: 50000,
    paidCents: 50000,
    currency: "USD",
    retainedProcessingFeeCents: 0,
    policyConfigured: true,
};

const FREE_QUOTE = { ...QUOTE, feeCents: 0, refundCents: 0, paidCents: 0, reason: "no_policy" };

interface Harness {
    /** Quote requests, in order, as the reason the UI asked about. */
    quoted: string[];
    /** Cancel submissions, as the raw form fields. */
    submitted: Record<string, string>[];
}

function renderCard(
    quoteFor: (reason: string) => unknown = () => QUOTE,
    cancelResult: unknown = { ok: true },
): Harness {
    const harness: Harness = { quoted: [], submitted: [] };

    const Stub = createRoutesStub([
        {
            path: "/hub",
            // A loader, because the real hub has one: a fetcher submission
            // revalidates the page, which re-renders the card and hands the
            // modal a fresh `onClose`. Without it the harness would be a
            // quieter page than the one this component actually lives on, and
            // the re-render-driven failures below could not happen at all.
            loader: async () => ({ revalidatedAt: performance.now() }),
            HydrateFallback: () => <div />,
            Component: () => <CardHost status={INSPECTION_STATUS.SCHEDULED} />,
            action: async () => ({ ok: true }),
        },
        {
            path: "/resources/inspection-cancellation",
            loader: async ({ request }) => {
                const reason = new URL(request.url).searchParams.get("reason") ?? "";
                harness.quoted.push(reason);
                const quote = quoteFor(reason);
                return quote
                    ? { ok: true, quote }
                    : { ok: false, error: "Could not price this cancellation." };
            },
            action: async ({ request }) => {
                const form = await request.formData();
                harness.submitted.push(Object.fromEntries(form) as Record<string, string>);
                return cancelResult;
            },
        },
    ]);

    render(<Stub initialEntries={["/hub"]} />);
    return harness;
}

/** Renders the card with a real fetcher, the way the hub route does. */
function CardHost({ status }: { status: string }) {
    // Reading the loader data is what subscribes this component to
    // revalidation — see the loader's comment.
    useLoaderData();
    return <LifecycleCard status={status} inspectionId="insp-1" fetcher={useFetcher()} />;
}

/** Waits for the card to hydrate (the harness route has a loader) and opens the flow. */
const openModal = async () =>
    fireEvent.click(await screen.findByRole("button", { name: "Cancel inspection" }));

beforeEach(() => {
    document.body.innerHTML = "";
});

describe("cancelling an inspection from the hub", () => {
    it("offers the control on an active inspection", async () => {
        renderCard();
        expect(await screen.findByRole("button", { name: "Cancel inspection" })).toBeTruthy();
    });

    it("shows what the cancellation costs before the confirm is reachable", async () => {
        renderCard();
        await openModal();

        // The continue control exists immediately but must be inert until the
        // quote lands — that ordering IS the policy ladder.
        const continueBtn = () => screen.getByRole("button", { name: "Continue" });
        expect(continueBtn().hasAttribute("disabled")).toBe(true);

        expect(await screen.findByText(/Fee your company keeps: \$125\.00/)).toBeTruthy();
        expect(screen.getByText(/Refunded to the client: \$375\.00/)).toBeTruthy();
        // …and it says WHY, not just how much.
        expect(screen.getByText(/inside your notice window/)).toBeTruthy();
        await waitFor(() => expect(continueBtn().hasAttribute("disabled")).toBe(false));
    });

    it("re-prices when the reason changes", async () => {
        const harness = renderCard((reason) =>
            reason === "no_show" ? { ...QUOTE, feeCents: 50000, refundCents: 0, reason: "no_show" } : QUOTE,
        );
        await openModal();
        await screen.findByText(/Fee your company keeps: \$125\.00/);

        fireEvent.change(screen.getByLabelText(/Why is it being cancelled/), {
            target: { value: "no_show" },
        });

        // The previous reason's figure must not survive into the new reason —
        // a wrong number under the right label is worse than no number.
        await waitFor(() => expect(screen.queryByText(/\$125\.00/)).toBeNull());
        expect(await screen.findByText(/Fee your company keeps: \$500\.00/)).toBeTruthy();
        expect(harness.quoted).toEqual(["client_cancelled", "no_show"]);
    });

    it("names the fee and the refund in the confirmation, and that it cannot be undone", async () => {
        renderCard();
        await openModal();
        await screen.findByText(/Fee your company keeps: \$125\.00/);
        fireEvent.click(screen.getByRole("button", { name: "Continue" }));

        const dialog = await screen.findByRole("dialog");
        expect(dialog.textContent).toMatch(/\$125\.00 is kept as a cancellation fee/);
        expect(dialog.textContent).toMatch(/\$375\.00 is refunded to the client/);
        expect(dialog.textContent).toMatch(/cannot be un-cancelled/i);
    });

    it("says plainly when nothing is charged rather than quoting a zero", async () => {
        renderCard(() => FREE_QUOTE);
        await openModal();
        await screen.findByText(/no cancellation policy configured/i);
        fireEvent.click(screen.getByRole("button", { name: "Continue" }));

        const dialog = await screen.findByRole("dialog");
        expect(dialog.textContent).toMatch(/no cancellation fee applies and there is nothing to refund/i);
    });

    it("cancels nothing until the confirmation is accepted", async () => {
        const harness = renderCard();
        await openModal();
        await screen.findByText(/Fee your company keeps: \$125\.00/);

        fireEvent.click(screen.getByRole("button", { name: "Continue" }));
        await screen.findByRole("dialog");
        expect(harness.submitted, "opening the confirmation already cancelled").toHaveLength(0);

        fireEvent.click(
            within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel the inspection" }),
        );
        await waitFor(() => expect(harness.submitted).toHaveLength(1));
    });

    it("acknowledges exactly the fee it displayed", async () => {
        const harness = renderCard();
        await openModal();
        await screen.findByText(/Fee your company keeps: \$125\.00/);
        fireEvent.click(screen.getByRole("button", { name: "Continue" }));
        fireEvent.click(
            within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel the inspection" }),
        );

        await waitFor(() => expect(harness.submitted).toHaveLength(1));
        expect(harness.submitted[0]).toMatchObject({
            id: "insp-1",
            reason: "client_cancelled",
            // The figure rendered above, in cents. Anything else is a fee the
            // server will refuse — or worse, one nobody read.
            acknowledgedFeeCents: "12500",
        });
    });

    it("backing out of the confirmation cancels nothing", async () => {
        const harness = renderCard();
        await openModal();
        await screen.findByText(/Fee your company keeps: \$125\.00/);
        fireEvent.click(screen.getByRole("button", { name: "Continue" }));

        fireEvent.click(
            within(await screen.findByRole("dialog")).getByRole("button", { name: "Keep the inspection" }),
        );
        await waitFor(() => expect(screen.queryByText(/cannot be un-cancelled/i)).toBeNull());
        expect(harness.submitted).toHaveLength(0);
    });

    it("keeps the confirm shut when the quote cannot be obtained", async () => {
        // The route's own refusal text is shown — the card does not substitute a
        // reassuring one — and the confirm never opens. Fail-closed: no quote,
        // no cancellation.
        renderCard(() => null);
        await openModal();
        await screen.findByText("Could not price this cancellation.");
        expect(screen.getByRole("button", { name: "Continue" }).hasAttribute("disabled")).toBe(true);
    });

    it("stays usable after a cancel the server refused", async () => {
        // A refused cancel is a dead end unless three things hold: the server's
        // refusal is shown, the quote is still on screen, and the confirmation
        // opens again. What this does NOT prove is the render-order hazard
        // described on the success effect in CancelInspectionModal — that one
        // needs a parent re-render landing between the reopen and the click, and
        // a test that arranged it would be arranging the bug rather than the use.
        const harness = renderCard(() => QUOTE, {
            ok: false,
            error: "The inspection could not be cancelled.",
        });
        await openModal();
        await screen.findByText(/Fee your company keeps: \$125\.00/);
        const quotedBeforeAttempt = harness.quoted.length;
        fireEvent.click(screen.getByRole("button", { name: "Continue" }));
        fireEvent.click(
            within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel the inspection" }),
        );

        await screen.findByText("The inspection could not be cancelled.");
        // …and it re-asks what the cancellation costs rather than leaving the
        // pre-refusal figure standing. The server may have re-priced — that is
        // one of the reasons it refuses — so the second attempt must acknowledge
        // a number fetched after the first was rejected.
        await waitFor(() => expect(harness.quoted.length).toBeGreaterThan(quotedBeforeAttempt));

        // Second attempt: the confirmation opens and stays open.
        fireEvent.click(screen.getByRole("button", { name: "Continue" }));
        const dialog = await screen.findByRole("dialog");
        expect(dialog.textContent).toMatch(/\$125\.00 is kept as a cancellation fee/);
        fireEvent.click(within(dialog).getByRole("button", { name: "Cancel the inspection" }));
        await waitFor(() => expect(harness.submitted).toHaveLength(2));
    });

    it("offers no cancel control on an inspection that is already cancelled", () => {
        const Stub = createRoutesStub([
            {
                path: "/hub",
                Component: () => <CardHost status={INSPECTION_STATUS.CANCELLED} />,
            },
        ]);
        render(<Stub initialEntries={["/hub"]} />);
        expect(screen.queryByRole("button", { name: "Cancel inspection" })).toBeNull();
    });
});
