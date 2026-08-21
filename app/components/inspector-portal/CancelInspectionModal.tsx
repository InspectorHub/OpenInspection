import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { Modal, Button, Select, Textarea } from "@core/shared-ui";
import { ConfirmDialog } from "~/components/ConfirmDialog";
import { formatCents } from "~/lib/hub-blocks";
import { useGuardedSubmit } from "~/hooks/useGuardedSubmit";
import { m } from "~/paraglide/messages";
import {
    CANCELLATION_REASONS,
    type CancellationReason,
} from "../../../server/lib/cancellation-reason";
import type {
    loader as quoteLoader,
    action as cancelAction,
    CancellationQuoteView,
} from "~/routes/resources/inspection-cancellation";

/**
 * Cancelling an inspection, priced before it happens.
 *
 * TWO STEPS, AND THE ORDER IS THE FEATURE. The reason decides the outcome — a
 * no-show and a weather cancellation are different rungs of the same ladder —
 * so the reason is picked first, the quote is fetched for THAT reason, and only
 * then does the confirm become reachable. A cancellation that charges a fee
 * nobody was shown is a chargeback, which is why the API refuses one too: the
 * confirm echoes `acknowledgedFeeCents` back, and the server compares it.
 *
 * The second step is the shared `ConfirmDialog`, the same component the report
 * delete uses, and it NAMES the money rather than asking "are you sure?" — the
 * fee being kept, the amount going back, and that neither is reversible from
 * this page. The first modal closes as the dialog opens, so the two never stack.
 */

/** Reason → label. Keyed off the server enum, so a new reason is a type error. */
const REASON_LABEL: Record<CancellationReason, () => string> = {
    client_cancelled: m.inspections_hub_cancel_reason_client_cancelled,
    no_show: m.inspections_hub_cancel_reason_no_show,
    weather: m.inspections_hub_cancel_reason_weather,
    inspector_unavailable: m.inspections_hub_cancel_reason_inspector_unavailable,
    property_unavailable: m.inspections_hub_cancel_reason_property_unavailable,
    rescheduled: m.inspections_hub_cancel_reason_rescheduled,
    other: m.inspections_hub_cancel_reason_other,
};

/**
 * Outcome code → the sentence explaining it.
 *
 * These are the codes `resolveCancellation` produces. Not typed as an exhaustive
 * Record: the code crosses the wire as a plain string, and a code this build has
 * never heard of must render as nothing rather than crash the dialog that is
 * about to move money.
 */
const WHY: Record<string, () => string> = {
    inspector_initiated: m.inspections_hub_cancel_why_inspector_initiated,
    no_policy: m.inspections_hub_cancel_why_no_policy,
    no_scheduled_instant: m.inspections_hub_cancel_why_no_scheduled_instant,
    sufficient_notice: m.inspections_hub_cancel_why_sufficient_notice,
    late_cancellation: m.inspections_hub_cancel_why_late_cancellation,
    no_show: m.inspections_hub_cancel_why_no_show,
};

const QUOTE_ROUTE = "/resources/inspection-cancellation";

export function CancelInspectionModal({
    open,
    inspectionId,
    onClose,
}: {
    open: boolean;
    inspectionId: string;
    onClose: () => void;
}) {
    // Separate fetchers on purpose: one is a read that re-runs whenever the
    // reason changes, the other is the write. Sharing one would let a re-quote
    // in flight overwrite the cancel's result.
    const quoteFetcher = useFetcher<typeof quoteLoader>();
    // #106 - cancelling charges the acknowledged fee and closes the order. The
    // quote fetcher above stays a plain read.
    const { fetcher: cancelFetcher, submit: submitCancel, busy: cancelling } =
        useGuardedSubmit<typeof cancelAction>();

    const [reason, setReason] = useState<CancellationReason>("client_cancelled");
    const [notes, setNotes] = useState("");
    const [confirming, setConfirming] = useState(false);

    const cancelResult = cancelFetcher.state === "idle" ? cancelFetcher.data : undefined;

    // ONE ORIGIN FOR THE NUMBER ON SCREEN. The panel is fed by this loader and
    // nothing else — including on the 409 path, where the API hands back a
    // freshly computed quote. Rendering that payload directly would be a second
    // source that goes stale the instant the reason is changed underneath it,
    // and "the fee for a question you are no longer asking" is precisely the
    // figure this feature must never show.
    //
    // A refused cancel therefore re-prices, and nothing here has to arrange it:
    // React Router revalidates active fetcher loads after any mutation, so the
    // submit below re-runs this load on its own. Adding `cancelResult` to the
    // deps to "make sure" only fires a second, identical request.
    useEffect(() => {
        if (!open) return;
        const params = new URLSearchParams({ id: inspectionId, reason });
        quoteFetcher.load(`${QUOTE_ROUTE}?${params.toString()}`);
        // quoteFetcher is stable per instance; including it would loop.
    }, [open, inspectionId, reason]);

    // Success closes the dialog; the hub revalidates behind it and the card
    // flips to its cancelled state.
    //
    // A FAILURE deliberately does nothing here. Closing the confirmation on a
    // failure looks like the obvious companion line, and it is both redundant —
    // `submit` already left the confirmation before the request went out — and
    // order-dependent: this effect re-runs whenever the parent hands down a new
    // `onClose`, which the hub does on every revalidation, so a reset living
    // here can fire AFTER the inspector has reopened the confirmation and shut
    // it under them. Nothing to reset means nothing to mistime.
    useEffect(() => {
        if (open && cancelResult?.ok) onClose();
    }, [open, cancelResult, onClose]);

    const loaded = quoteFetcher.data;
    const quote: CancellationQuoteView | undefined = loaded?.ok ? loaded.quote : undefined;
    const quoteError = loaded && !loaded.ok ? loaded.error : undefined;
    const quoting = quoteFetcher.state !== "idle";
    const cancelError = cancelResult && !cancelResult.ok ? cancelResult.error : undefined;

    function submit() {
        if (!quote) return;
        // Dismiss the confirmation only for a call the guard accepted.
        const sent = submitCancel(
            {
                id: inspectionId,
                reason,
                notes,
                // Echoed back exactly as displayed. The server rejects anything else.
                acknowledgedFeeCents: String(quote.feeCents),
            },
            { method: "post", action: QUOTE_ROUTE },
        );
        if (sent) setConfirming(false);
    }

    return (
        <>
            <Modal
                open={open && !confirming}
                onClose={onClose}
                title={m.inspections_hub_cancel_title()}
                size="md"
                footer={
                    <>
                        <Button variant="secondary" size="md" onClick={onClose} disabled={cancelling}>
                            {m.inspections_hub_cancel_keep()}
                        </Button>
                        {/* Unreachable until a quote is in hand: the whole point of
                            the ladder is that nobody cancels without seeing the fee. */}
                        <Button
                            variant="danger"
                            size="md"
                            onClick={() => setConfirming(true)}
                            disabled={!quote || quoting || cancelling}
                        >
                            {cancelling ? m.inspections_hub_cancel_working() : m.inspections_hub_cancel_continue()}
                        </Button>
                    </>
                }
            >
                <div className="space-y-4">
                    <Select
                        label={m.inspections_hub_cancel_reason_label()}
                        hint={m.inspections_hub_cancel_reason_hint()}
                        value={reason}
                        onChange={(e) => setReason(e.target.value as CancellationReason)}
                        options={CANCELLATION_REASONS.map((value) => ({
                            value,
                            label: REASON_LABEL[value](),
                        }))}
                    />

                    <Textarea
                        label={m.inspections_hub_cancel_notes_label()}
                        placeholder={m.inspections_hub_cancel_notes_ph()}
                        rows={2}
                        maxLength={500}
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                    />

                    <div
                        className="rounded-ih-card border border-ih-border bg-ih-bg-muted p-3"
                        data-testid="cancellation-quote"
                    >
                        <p className="text-[11px] font-bold uppercase tracking-wide text-ih-fg-3">
                            {m.inspections_hub_cancel_quote_heading()}
                        </p>

                        {/* The figures are HIDDEN while re-pricing, not left in
                            place. A reason change re-prices, and the previous
                            reason's fee sitting under the new reason's label is
                            a wrong number presented as the answer — the confirm
                            being disabled meanwhile protects the money but not
                            the reader. */}
                        {quoting && (
                            <p className="mt-2 text-[13px] text-ih-fg-3">
                                {m.inspections_hub_cancel_quote_loading()}
                            </p>
                        )}

                        {!quoting && quote && <QuoteFigures quote={quote} />}

                        {!quoting && !quote && quoteError && (
                            <p className="mt-2 text-[13px] text-ih-bad-fg">{quoteError}</p>
                        )}
                    </div>

                    {cancelError && (
                        <p className="text-[12px] text-ih-bad-fg" role="alert">
                            {cancelError}
                        </p>
                    )}
                </div>
            </Modal>

            {/* Step two. Names the fee, names the refund, and says plainly that
                neither comes back — the model is the report-delete dialog, which
                states what is destroyed rather than asking "are you sure?". */}
            <ConfirmDialog
                open={open && confirming && !!quote}
                title={m.inspections_hub_cancel_confirm_title()}
                message={quote ? confirmMessage(quote) : ""}
                confirmLabel={m.inspections_hub_cancel_confirm_action()}
                cancelLabel={m.inspections_hub_cancel_keep()}
                busy={cancelling}
                onCancel={() => setConfirming(false)}
                onConfirm={submit}
            />
        </>
    );
}

/** The priced outcome, as figures plus the sentence that explains them. */
function QuoteFigures({ quote }: { quote: CancellationQuoteView }) {
    const money = (cents: number) => formatCents(cents, { currency: quote.currency });
    const why = WHY[quote.reason];

    return (
        <div className="mt-2 space-y-1.5 text-[13px]">
            <p className={quote.feeCents > 0 ? "font-bold text-ih-bad-fg" : "text-ih-fg-2"}>
                {m.inspections_hub_cancel_quote_fee({ amount: money(quote.feeCents) })}
            </p>
            <p className={quote.refundCents > 0 ? "font-bold text-ih-ok-fg" : "text-ih-fg-2"}>
                {m.inspections_hub_cancel_quote_refund({ amount: money(quote.refundCents) })}
            </p>
            <p className="text-ih-fg-3">
                {m.inspections_hub_cancel_quote_collected({ amount: money(quote.paidCents) })}
            </p>
            {why && <p className="text-ih-fg-2">{why()}</p>}
            {quote.cappedAtCollected && (
                <p className="text-ih-watch-fg">
                    {m.inspections_hub_cancel_capped({ amount: money(quote.feeCents) })}
                </p>
            )}
            {quote.retainedProcessingFeeCents > 0 && (
                <p className="text-ih-watch-fg">
                    {m.inspections_hub_cancel_processing_fee({
                        amount: money(quote.retainedProcessingFeeCents),
                    })}
                </p>
            )}
        </div>
    );
}

/**
 * The confirmation sentence. Three cases rather than one with substituted
 * zeroes: "refunds $0.00 to the client" is a statement about money that reads
 * as a promise, where "there is nothing to refund" is the fact.
 */
function confirmMessage(quote: CancellationQuoteView): string {
    const money = (cents: number) => formatCents(cents, { currency: quote.currency });
    if (quote.feeCents > 0) {
        return m.inspections_hub_cancel_confirm_fee({
            fee: money(quote.feeCents),
            refund: money(quote.refundCents),
        });
    }
    if (quote.refundCents > 0) {
        return m.inspections_hub_cancel_confirm_refund({ refund: money(quote.refundCents) });
    }
    return m.inspections_hub_cancel_confirm_free();
}
