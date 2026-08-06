import { useState } from "react";
import { useFetcher } from "react-router";
import type { action } from "~/routes/settings-services";
import { toHundredths, fromHundredths } from "~/lib/settings-services";
import { m } from "~/paraglide/messages";

/**
 * The switch for pay splits (#278), on the row of the service it prices.
 *
 * It sits beside QualificationWidget and is deliberately its twin — same
 * disclosure, same inline panel, same tokens — because the two answer adjacent
 * questions about one service ("who MAY run this" / "what they EARN running
 * it") and a second visual idiom for the second question would read as a
 * different kind of setting.
 *
 * The unit boundary is the thing to be careful with here. A person types 60
 * meaning 60% and 125 meaning $125.00; the API takes basis points and integer
 * cents under names that say so. `toHundredths` is the only ×100 in the path
 * and it is called next to the "%" and "$" the person can see.
 */

export interface PayRule {
    id: string;
    userId: string | null;
    type: "percent" | "fixed" | "percent_after_deduction";
    percentBps: number | null;
    amountCents: number | null;
    deductionCents: number | null;
}

interface Member {
    id: string;
    email: string;
    role: string;
}

interface PayRuleWidgetProps {
    serviceId: string;
    rules: PayRule[];
    members: Member[];
}

const FIELD =
    "h-7 px-2 rounded-md border border-ih-border bg-ih-bg-card text-[12px] text-ih-fg-1 " +
    "focus:outline-none focus:ring-2 focus:ring-ih-primary";

function rateOf(rule: PayRule): string {
    return fromHundredths(rule.type === "fixed" ? rule.amountCents : rule.percentBps);
}

/**
 * One rule, editable in place — and also the form for a new one, with `rule`
 * absent. The same component both ways on purpose: an "add" form that drifts
 * from the "edit" form is how a field ends up settable only when creating.
 */
function RuleRow({
    serviceId, rule, members, takenUserIds, allowDefault, onDone,
}: {
    serviceId: string;
    rule?: PayRule;
    members: Member[];
    takenUserIds: string[];
    /** Is the service-default slot still free (or is it this very rule)? */
    allowDefault: boolean;
    onDone?: () => void;
}) {
    const fetcher = useFetcher<typeof action>({ key: `pay-rule-${rule?.id ?? "new"}-${serviceId}` });
    const [type, setType] = useState<PayRule["type"]>(rule?.type ?? "percent");
    const [rate, setRate] = useState(rule ? rateOf(rule) : "");
    const [deduction, setDeduction] = useState(fromHundredths(rule?.deductionCents));
    const [userId, setUserId] = useState(rule?.userId ?? "");
    const [localError, setLocalError] = useState<string | null>(null);

    const isPercent = type !== "fixed";
    const busy = fetcher.state !== "idle";
    const result = fetcher.state === "idle" ? fetcher.data : undefined;
    const serverError =
        result && "intent" in result && "ok" in result && String(result.intent).startsWith("pay-rule") && result.ok === false
            ? ((result as { message?: string }).message ?? m.settings_pay_rule_error_save())
            : null;

    function save() {
        // Refused here rather than sent: an empty or zero rate would reach the
        // API as a 400 the person has to translate back into "the box is blank".
        if (toHundredths(rate) === null) return setLocalError(m.settings_pay_rule_error_rate());
        if (type === "percent_after_deduction" && toHundredths(deduction) === null) {
            return setLocalError(m.settings_pay_rule_error_rate());
        }
        setLocalError(null);
        fetcher.submit(
            {
                intent: "pay-rule-save",
                serviceId,
                ruleId: rule?.id ?? "",
                userId,
                type,
                rate: String(toHundredths(rate)),
                deduction: type === "percent_after_deduction" ? String(toHundredths(deduction)) : "",
            },
            { method: "post" },
        );
        onDone?.();
    }

    return (
        <div className="border border-ih-border rounded-md p-2 bg-ih-bg-card space-y-2">
            <div className="flex flex-wrap items-center gap-2">
                <label className="text-[11px] text-ih-fg-3">{m.settings_pay_rule_applies_to()}</label>
                <select
                    className={FIELD}
                    value={userId}
                    disabled={Boolean(rule)}
                    onChange={(e) => setUserId(e.target.value)}
                >
                    {allowDefault && <option value="">{m.settings_pay_rule_everyone()}</option>}
                    {members
                        .filter((mem) => mem.id === rule?.userId || !takenUserIds.includes(mem.id))
                        .map((mem) => (
                            <option key={mem.id} value={mem.id}>{mem.email}</option>
                        ))}
                </select>

                <label className="text-[11px] text-ih-fg-3">{m.settings_pay_rule_rate()}</label>
                <select
                    className={FIELD}
                    value={type}
                    onChange={(e) => setType(e.target.value as PayRule["type"])}
                >
                    <option value="percent">{m.settings_pay_rule_type_percent()}</option>
                    <option value="fixed">{m.settings_pay_rule_type_fixed()}</option>
                    <option value="percent_after_deduction">{m.settings_pay_rule_type_after_deduction()}</option>
                </select>

                <div className="flex items-center gap-1">
                    {!isPercent && <span className="text-[12px] text-ih-fg-3">$</span>}
                    <input
                        type="number"
                        min="0"
                        step="0.01"
                        className={`${FIELD} w-20`}
                        value={rate}
                        onChange={(e) => setRate(e.target.value)}
                        aria-label={m.settings_pay_rule_rate()}
                    />
                    {isPercent && <span className="text-[12px] text-ih-fg-3">%</span>}
                </div>

                {type === "percent_after_deduction" && (
                    <div className="flex items-center gap-1">
                        <label className="text-[11px] text-ih-fg-3">{m.settings_pay_rule_deduction_label()}</label>
                        <span className="text-[12px] text-ih-fg-3">$</span>
                        <input
                            type="number"
                            min="0"
                            step="0.01"
                            className={`${FIELD} w-20`}
                            value={deduction}
                            onChange={(e) => setDeduction(e.target.value)}
                            aria-label={m.settings_pay_rule_deduction_label()}
                        />
                    </div>
                )}

                <button
                    type="button"
                    onClick={save}
                    disabled={busy}
                    className="h-7 px-3 rounded-md bg-ih-primary text-ih-fg-inverse font-bold text-[12px] hover:bg-ih-primary-600 transition-colors disabled:opacity-50"
                >
                    {busy ? m.common_saving() : m.common_save()}
                </button>

                {rule ? (
                    <fetcher.Form method="post" className="inline">
                        <input type="hidden" name="intent" value="pay-rule-delete" />
                        <input type="hidden" name="serviceId" value={serviceId} />
                        <input type="hidden" name="ruleId" value={rule.id} />
                        <button type="submit" className="h-7 px-2 text-[12px] font-semibold text-ih-bad-fg hover:underline">
                            {m.settings_pay_rule_remove()}
                        </button>
                    </fetcher.Form>
                ) : (
                    <button
                        type="button"
                        onClick={onDone}
                        className="h-7 px-3 rounded-md border border-ih-border text-[12px] font-medium text-ih-fg-2 hover:bg-ih-bg-muted transition-colors"
                    >
                        {m.common_cancel()}
                    </button>
                )}
            </div>

            {type === "percent_after_deduction" && (
                <p className="text-[11px] text-ih-fg-3">{m.settings_pay_rule_deduction_hint()}</p>
            )}
            {(localError || serverError) && (
                <p className="text-[12px] text-ih-bad-fg">{localError ?? serverError}</p>
            )}
        </div>
    );
}

export function PayRuleWidget({ serviceId, rules, members }: PayRuleWidgetProps) {
    const [open, setOpen] = useState(false);
    const [adding, setAdding] = useState(false);

    const summary =
        rules.length === 0
            ? m.settings_pay_rule_none()
            : rules.length === 1
                ? m.settings_pay_rule_summary_one()
                : m.settings_pay_rule_summary_many({ count: rules.length });

    // A rule already exists for these, and the DB refuses a second one. Hiding
    // them from the picker turns a 409 into a choice that was never offered.
    const takenUserIds = rules.map((r) => r.userId).filter((id): id is string => id !== null);
    const hasDefault = rules.some((r) => r.userId === null);
    const everyoneTaken = hasDefault && members.every((mem) => takenUserIds.includes(mem.id));

    if (members.length === 0) {
        return (
            <div className="text-[12px] text-ih-fg-3">
                <span className="font-medium">{m.settings_pay_rule_label()}</span> {summary}
            </div>
        );
    }

    return (
        <div className="mt-2">
            {!open ? (
                <div className="flex items-center gap-3">
                    <span className="text-[12px] text-ih-fg-3">
                        <span className="font-medium">{m.settings_pay_rule_label()}</span> {summary}
                    </span>
                    <button
                        type="button"
                        onClick={() => setOpen(true)}
                        className="text-[12px] font-semibold text-ih-primary hover:underline"
                    >
                        {m.settings_pay_rule_change_link()}
                    </button>
                </div>
            ) : (
                <div className="border border-ih-border rounded-md p-3 space-y-2 bg-ih-bg-muted">
                    <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">
                        {m.settings_pay_rule_heading()}
                    </p>
                    <p className="text-[12px] text-ih-fg-3">{m.settings_pay_rule_explain()}</p>
                    {/* The divisor is not obvious and it halves people's pay when
                        it surprises them, so it is stated where the number is typed. */}
                    <p className="text-[12px] text-ih-fg-3">{m.settings_pay_rule_divisor_note()}</p>

                    {rules.length === 0 && !adding && (
                        <p className="text-[12px] text-ih-fg-3 italic">{m.settings_pay_rule_empty()}</p>
                    )}

                    {rules.map((rule) => (
                        <RuleRow
                            key={rule.id}
                            serviceId={serviceId}
                            rule={rule}
                            members={members}
                            takenUserIds={takenUserIds}
                            allowDefault={rule.userId === null}
                        />
                    ))}

                    {adding && (
                        <RuleRow
                            serviceId={serviceId}
                            members={members}
                            takenUserIds={takenUserIds}
                            allowDefault={!hasDefault}
                            onDone={() => setAdding(false)}
                        />
                    )}

                    <div className="flex items-center gap-3 pt-1">
                        {!adding && !everyoneTaken && (
                            <button
                                type="button"
                                onClick={() => setAdding(true)}
                                className="text-[12px] font-semibold text-ih-primary hover:underline"
                            >
                                {m.settings_pay_rule_add()}
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => { setAdding(false); setOpen(false); }}
                            className="h-7 px-3 rounded-md border border-ih-border text-[12px] font-medium text-ih-fg-2 hover:bg-ih-bg-card transition-colors"
                        >
                            {m.common_close()}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
