import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { Card, Button, Modal } from "@core/shared-ui";
import { BlockHeading } from "./BlockHeading";
import { useGuardedSubmit } from "~/hooks/useGuardedSubmit";
import { m } from "~/paraglide/messages";
import type { action } from "~/routes/inspector-portal";

const FIELD_CLASS =
    "mt-1 w-full h-10 px-3 rounded-md border border-ih-border bg-ih-bg-card text-ih-fg-1 text-[14px] font-medium focus:border-ih-primary focus:shadow-ih-focus outline-none";
const LABEL_CLASS = "text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3";

/**
 * The back-office facts about the order: how the operator refers to it, where
 * it came from, and when the buyer closes.
 *
 * These lived in an "Order & referral" section of the report editor's settings
 * sheet — order facts, three clicks deep inside the report authoring surface,
 * with no presence at all on the page that runs the order. This card is
 * deliberately last in the grid: nobody opens the hub to read a referral source,
 * so it sits below the things they did come for.
 */
export function OrderDetailsCard({
    closingDate,
    referenceNumber,
    referralSource,
    referralSources,
    referredByContactId,
    referredByName,
}: {
    closingDate: string | null;
    referenceNumber: string | null;
    referralSource: string | null;
    referralSources: string[];
    referredByContactId: string | null;
    referredByName: string | null;
}) {
    const [open, setOpen] = useState(false);
    // #106 - this writes the order's own fields. `searchFetcher` below stays a
    // plain read (a debounced typeahead, nothing to double-submit).
    const { fetcher, submit, busy: saving } = useGuardedSubmit<typeof action>();

    // Task 8 — the referrer picker. A PERSON, not a channel and not only an
    // agent: a past client really does refer jobs, so the typeahead searches
    // every contact through the same search-contacts intent AddPersonModal
    // uses. State holds the picked contact; '' search + null pick = cleared.
    const searchFetcher = useFetcher<{ intent: "search-contacts"; contacts: Array<{ id: string; name: string; email: string | null }> }>();
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [referrerQuery, setReferrerQuery] = useState("");
    const [pickedReferrer, setPickedReferrer] = useState<{ id: string; name: string } | null>(
        referredByContactId ? { id: referredByContactId, name: referredByName ?? referredByContactId } : null,
    );
    useEffect(() => {
        if (!open) {
            setReferrerQuery("");
            setPickedReferrer(referredByContactId ? { id: referredByContactId, name: referredByName ?? referredByContactId } : null);
        }
    }, [open, referredByContactId, referredByName]);
    const onReferrerInput = (value: string) => {
        setReferrerQuery(value);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        if (value.trim().length < 2) return;
        debounceRef.current = setTimeout(() => {
            searchFetcher.submit({ intent: "search-contacts", search: value.trim() }, { method: "post" });
        }, 250);
    };

    const error =
        fetcher.state === "idle" && fetcher.data?.intent === "save-order" && !fetcher.data.ok
            ? fetcher.data.error
            : undefined;

    const save = (form: HTMLFormElement) => {
        const data = new FormData(form);
        // '' means "cleared" here, not "unchanged": every field in this modal is
        // rendered with its current value, so a blank box is a deliberate erase.
        // The columns are nullable, so null is what clears them.
        const text = (k: string) => {
            const v = String(data.get(k) ?? "").trim();
            return v === "" ? null : v;
        };
        const sent = submit(
            {
                intent: "save-order",
                payload: JSON.stringify({
                    closingDate: text("closingDate"),
                    referenceNumber: text("referenceNumber"),
                    referralSource: text("referralSource"),
                    referredByContactId: pickedReferrer?.id ?? null,
                }),
            },
            { method: "post" },
        );
        // Close only on a call the guard accepted.
        if (sent) setOpen(false);
    };

    return (
        <Card className="p-5">
            <BlockHeading title={m.inspections_hub_block_details()} />
            <dl className="space-y-2 mb-4">
                <Row label={m.inspections_hub_details_reference()} value={referenceNumber} />
                <Row label={m.inspections_hub_details_referral()} value={referralSource} />
                <Row label={m.inspections_hub_details_referred_by()} value={referredByName} />
                <Row label={m.inspections_hub_details_closing()} value={closingDate} />
            </dl>
            {error && <p className="text-[12px] text-ih-bad-fg mb-2">{error}</p>}
            <Button variant="secondary" size="sm" onClick={() => setOpen(true)} disabled={saving}>
                {m.inspections_hub_details_edit()}
            </Button>

            <Modal open={open} onClose={() => setOpen(false)} title={m.inspections_hub_details_edit()}>
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        save(e.currentTarget);
                    }}
                    className="space-y-4"
                >
                    <label className="block">
                        <span className={LABEL_CLASS}>{m.inspections_hub_details_reference()}</span>
                        <input
                            type="text"
                            name="referenceNumber"
                            maxLength={64}
                            defaultValue={referenceNumber ?? ""}
                            className={FIELD_CLASS}
                            data-testid="hub-details-reference"
                        />
                    </label>
                    <label className="block">
                        <span className={LABEL_CLASS}>{m.inspections_hub_details_referral()}</span>
                        <select
                            name="referralSource"
                            defaultValue={referralSource ?? ""}
                            className={FIELD_CLASS}
                            data-testid="hub-details-referral"
                        >
                            <option value="">{m.inspections_hub_details_referral_select()}</option>
                            {/* A value already on the row that is no longer in the
                                tenant list still has to be selectable, or opening
                                this modal and saving would silently erase it. */}
                            {(referralSource && !referralSources.includes(referralSource)
                                ? [referralSource, ...referralSources]
                                : referralSources
                            ).map((s) => (
                                <option key={s} value={s}>
                                    {s}
                                </option>
                            ))}
                        </select>
                    </label>
                    <div>
                        <span className={LABEL_CLASS}>{m.inspections_hub_details_referred_by()}</span>
                        {pickedReferrer ? (
                            <div className="mt-1 flex items-center justify-between gap-2 h-10 px-3 rounded-md border border-ih-border bg-ih-bg-muted text-[14px]">
                                <span className="font-medium text-ih-fg-1 truncate">{pickedReferrer.name}</span>
                                <button
                                    type="button"
                                    onClick={() => setPickedReferrer(null)}
                                    className="text-[12px] font-semibold text-ih-fg-3 hover:text-ih-fg-1 shrink-0"
                                >
                                    {m.inspections_hub_details_referred_by_clear()}
                                </button>
                            </div>
                        ) : (
                            <>
                                <input
                                    type="text"
                                    value={referrerQuery}
                                    onChange={(e) => onReferrerInput(e.target.value)}
                                    placeholder={m.inspections_hub_details_referred_by_placeholder()}
                                    className={FIELD_CLASS}
                                    data-testid="hub-details-referred-by"
                                />
                                {referrerQuery.trim().length >= 2 && (searchFetcher.data?.contacts?.length ?? 0) > 0 && (
                                    <ul className="mt-1 rounded-md border border-ih-border bg-ih-bg-card divide-y divide-ih-border/60 max-h-40 overflow-y-auto">
                                        {searchFetcher.data!.contacts.map((c) => (
                                            <li key={c.id}>
                                                <button
                                                    type="button"
                                                    onClick={() => { setPickedReferrer({ id: c.id, name: c.name }); setReferrerQuery(""); }}
                                                    className="w-full px-3 py-2 text-left text-[13px] text-ih-fg-1 hover:bg-ih-bg-muted"
                                                >
                                                    {c.name}
                                                    {c.email && <span className="text-ih-fg-4"> · {c.email}</span>}
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </>
                        )}
                    </div>
                    <label className="block">
                        <span className={LABEL_CLASS}>{m.inspections_hub_details_closing()}</span>
                        <input
                            type="date"
                            name="closingDate"
                            lang="en"
                            defaultValue={closingDate ?? ""}
                            className={FIELD_CLASS}
                            data-testid="hub-details-closing"
                        />
                    </label>
                    <div className="flex items-center justify-end gap-2 pt-1">
                        <Button variant="secondary" size="sm" type="button" onClick={() => setOpen(false)}>
                            {m.common_cancel()}
                        </Button>
                        <Button variant="primary" size="sm" type="submit" disabled={saving}>
                            {m.common_save()}
                        </Button>
                    </div>
                </form>
            </Modal>
        </Card>
    );
}

function Row({ label, value }: { label: string; value: string | null }) {
    return (
        <div className="flex items-baseline justify-between gap-3 text-[13px]">
            <dt className="text-ih-fg-3 shrink-0">{label}</dt>
            <dd className={value ? "text-ih-fg-1 font-medium text-right" : "text-ih-fg-4 text-right"}>
                {value || m.inspections_hub_details_unset()}
            </dd>
        </div>
    );
}
