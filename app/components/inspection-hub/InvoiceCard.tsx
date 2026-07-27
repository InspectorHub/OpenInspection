import { useState } from "react";
import { useFetcher } from "react-router";
import { Card, Button, Modal } from "@core/shared-ui";
import { BlockHeading } from "./BlockHeading";
import { GateToggle } from "./GateToggle";
import { MoneyInput } from "~/components/MoneyInput";
import { formatCents, type PillTone } from "~/lib/hub-blocks";
import { m } from "~/paraglide/messages";
import type { action } from "~/routes/inspection-hub";

/**
 * What this inspection costs and whether it has been paid.
 *
 * IA-87 ② — the card showed an amount it could not change. The money authority
 * chain is invoice > Σ service lines > `inspections.price`, so the editable
 * thing depends on which tier is in force: with service lines booked, the
 * Services card owns the figure and this card says so; without them, the base
 * price is what gets billed, and it is editable here. Offering a "set price"
 * box that silently loses to a service line would be worse than not offering
 * one, which is roughly what the report editor's settings sheet was doing.
 */
export function InvoiceCard({
    pill,
    amountCents,
    paid,
    sent,
    payUrl,
    hasServiceLines,
    paymentRequired,
    basePriceCents,
    canManagePrice,
    onRequestPayment,
}: {
    pill: { tone: PillTone; label: string };
    amountCents: number;
    paid: boolean;
    sent: boolean;
    payUrl: string | null | undefined;
    hasServiceLines: boolean;
    paymentRequired: boolean;
    basePriceCents: number;
    canManagePrice: boolean;
    onRequestPayment: () => void;
}) {
    const [priceOpen, setPriceOpen] = useState(false);
    const [cents, setCents] = useState<number | null>(basePriceCents);
    const priceFetcher = useFetcher<typeof action>();

    // The base price only reaches the client when nothing outranks it. Once an
    // invoice exists the amount is frozen by the invoice; once services are
    // booked they are the source.
    const basePriceEditable = canManagePrice && !paid && !sent && !hasServiceLines;

    const priceError =
        priceFetcher.state === "idle" && priceFetcher.data?.intent === "save-order" && !priceFetcher.data.ok
            ? priceFetcher.data.error
            : undefined;

    return (
        <Card className="p-5">
            <BlockHeading title={m.inspections_hub_block_invoice()} pill={pill} />
            <p className="text-[15px] font-medium text-ih-fg-1 mb-1">{formatCents(amountCents)}</p>
            {hasServiceLines && (
                <p className="text-[11px] text-ih-fg-4 mb-3">{m.inspections_hub_invoice_from_services()}</p>
            )}
            {!hasServiceLines && <div className="mb-3" />}

            {priceError && <p className="text-[12px] text-ih-bad-fg mb-2">{priceError}</p>}

            {paid ? (
                // Paid is terminal — read-only (the pill already shows "Paid").
                <p className="text-[12px] text-ih-fg-3">{m.inspections_hub_invoice_paid()}</p>
            ) : (
                <div className="flex items-center gap-2 flex-wrap">
                    <Button variant="secondary" size="sm" onClick={onRequestPayment}>
                        {sent ? m.inspections_hub_invoice_resend() : m.inspections_hub_invoice_request()}
                    </Button>
                    {/* IA-34 — the pay page is token-gated; copy the tokenized link the
                        server built, never a bare `/invoice/:id` (which now 401s). No
                        link when no primary client email exists to bind a token to. */}
                    {sent && payUrl && <CopyLinkButton url={payUrl} />}
                    {basePriceEditable && (
                        <Button variant="secondary" size="sm" onClick={() => setPriceOpen(true)}>
                            {m.inspections_hub_invoice_set_amount()}
                        </Button>
                    )}
                </div>
            )}

            {!paid && (
                <GateToggle
                    field="paymentRequired"
                    checked={paymentRequired}
                    label={m.inspections_hub_gate_payment()}
                    testId="hub-gate-payment"
                />
            )}

            <Modal
                open={priceOpen}
                onClose={() => setPriceOpen(false)}
                title={m.inspections_hub_invoice_amount_title()}
                size="sm"
                footer={
                    <>
                        <Button variant="secondary" size="sm" onClick={() => setPriceOpen(false)}>
                            {m.common_cancel()}
                        </Button>
                        <Button
                            variant="primary"
                            size="sm"
                            disabled={priceFetcher.state !== "idle"}
                            onClick={() => {
                                priceFetcher.submit(
                                    {
                                        intent: "save-order",
                                        payload: JSON.stringify({ price: cents ?? 0 }),
                                    },
                                    { method: "post" },
                                );
                                setPriceOpen(false);
                            }}
                        >
                            {m.common_save()}
                        </Button>
                    </>
                }
            >
                <MoneyInput
                    cents={cents}
                    onChange={setCents}
                    className="w-full h-10 px-3 rounded-md border border-ih-border bg-ih-bg-card text-ih-fg-1 text-[14px] font-medium focus:border-ih-primary focus:shadow-ih-focus outline-none"
                    ariaLabel={m.inspections_hub_invoice_amount_title()}
                />
                <p className="mt-2 text-[11px] text-ih-fg-4">{m.inspections_hub_invoice_amount_hint()}</p>
            </Modal>
        </Card>
    );
}

/** Copies a public link to the clipboard with a transient "Copied" state. */
function CopyLinkButton({ url }: { url: string }) {
    const [copied, setCopied] = useState(false);
    const onCopy = () => {
        const absolute = typeof window !== "undefined" ? `${window.location.origin}${url}` : url;
        void navigator.clipboard?.writeText(absolute).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };
    return (
        <Button variant="secondary" size="sm" onClick={onCopy}>
            {copied ? m.inspections_hub_copied() : m.inspections_hub_copy_link()}
        </Button>
    );
}
