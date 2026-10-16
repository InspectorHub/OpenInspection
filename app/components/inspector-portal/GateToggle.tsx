import { useGuardedSubmit } from "~/hooks/useGuardedSubmit";
import { m } from "~/paraglide/messages";
import type { action } from "~/routes/inspector-portal";

/**
 * A per-inspection delivery gate: "the client can't open the report until this
 * has happened."
 *
 * The two gates (`agreementRequired`, `paymentRequired`) sat in a "Pricing &
 * gates" section of the report editor's settings sheet, where the only clue
 * they existed was a gear icon with no label. They do more than default the
 * publish dialog's checkboxes: `agreementRequired` decides whether
 * agreement-URL automations fire at all, and `paymentRequired` is what turns a
 * signing link into a sign-and-pay link. Each one belongs on the card for the
 * artifact it gates — the agreement gate with the agreements, the payment gate
 * with the invoice — because that is where somebody would look for it.
 *
 * It renders as a switch, not a button, and sits at the foot of the card BODY,
 * above the action row: it is a piece of this card's state, not one of the
 * card's actions. Saving is immediate; there is nothing to confirm and nothing
 * to lose by flipping it back.
 */
export function GateToggle({
    field,
    checked,
    label,
    testId,
    canEdit = true,
}: {
    field: "agreementRequired" | "paymentRequired";
    checked: boolean;
    label: string;
    testId?: string;
    /**
     * False for a viewer whose order edits the API refuses (an office user may
     * change only the date and inspector). The switch is then not rendered: a
     * read-only checkbox would still invite the click.
     */
    canEdit?: boolean;
}) {
    // #106 — the toggle writes an order-level gate; it goes through the guard.
    // The checkbox ignores changes (aria-disabled) while in flight, so the guard
    // never has to refuse a second change the user could still make.
    const { fetcher, submit, busy: saving } = useGuardedSubmit<typeof action>();

    // Optimistic: the switch follows the pending submission so it doesn't snap
    // back for the length of a round trip.
    const pending = fetcher.formData?.get("payload");
    const shown =
        typeof pending === "string"
            ? (JSON.parse(pending) as Record<string, boolean>)[field] ?? checked
            : checked;

    const failed = fetcher.state === "idle" && fetcher.data?.intent === "save-order" && !fetcher.data.ok;

    if (!canEdit) return null;

    return (
        <div className="mt-4 pt-3 border-t border-ih-border">
            <label className="flex items-start gap-2 text-[12px] text-ih-fg-3 cursor-pointer">
                <input
                    type="checkbox"
                    checked={shown}
                    // aria-disabled, not native: a focused checkbox that became disabled drops focus to <body>.
                    // The change is ignored while saving and the controlled value stays put.
                    aria-disabled={saving || undefined}
                    data-testid={testId}
                    onChange={(e) => {
                        if (saving) return;
                        submit(
                            {
                                intent: "save-order",
                                payload: JSON.stringify({ [field]: e.target.checked }),
                            },
                            { method: "post" },
                        );
                    }}
                    className="mt-0.5 h-4 w-4 rounded border-ih-border-strong text-ih-primary focus:ring-ih-primary/30 aria-disabled:opacity-50"
                />
                <span>{label}</span>
            </label>
            {failed && <p className="mt-1 text-[12px] text-ih-bad-fg">{m.inspections_hub_error_save_order()}</p>}
        </div>
    );
}
