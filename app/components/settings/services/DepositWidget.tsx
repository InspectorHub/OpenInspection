import { useState } from "react";
import { MoneyInput } from "~/components/MoneyInput";
import { formatCents } from "~/lib/money";
import { useDisplayLocale, useDisplayCurrency } from "~/hooks/useSessionContext";
import { useGuardedSubmit } from "~/hooks/useGuardedSubmit";
import {
    depositChoiceOf,
    depositPolicyFromChoice,
    type DepositChoice,
} from "~/lib/deposit-policy-form";
import type { DepositPolicy } from "../../../../server/lib/billing/deposit-policy";
import type { action } from "~/routes/settings-services";
import { m } from "~/paraglide/messages";

/**
 * The switch for the booking deposit (tier 2), on the row of the service it
 * applies to.
 *
 * Third in a set. QualificationWidget answers "who MAY run this", PayRuleWidget
 * answers "what they EARN running it", and this answers "what the client PAYS
 * UP FRONT" — three adjacent questions about one service, so the disclosure,
 * the inline panel and the tokens are deliberately the same. A third visual
 * language on the same row would read as a different kind of setting.
 *
 * WHERE IT DIFFERS FROM ITS TWIN, and both differences move money:
 *
 *   - FOUR states, not three. `null` inherits the company default and
 *     `{ type: 'none' }` opts out of it; they look alike and mean opposite
 *     things, which is why the picker spells both out instead of offering a
 *     blank that could be either.
 *   - The percent is a WHOLE PERCENT. `PayRuleWidget` multiplies by 100 on the
 *     way out because pay rates are basis points; a deposit percent is not, so
 *     nothing here multiplies. The only x100 in this path is dollars -> cents
 *     inside `MoneyInput`, beside the "$" the person can see. See
 *     `~/lib/deposit-policy-form`.
 */

const FIELD =
    "h-7 px-2 rounded-md border border-ih-border bg-ih-bg-card text-[12px] text-ih-fg-1 " +
    "focus:outline-none focus:ring-2 focus:ring-ih-primary";

interface DepositWidgetProps {
    serviceId: string;
    /** This service's own policy. NULL inherits the company default. */
    policy: DepositPolicy | null;
    /** The company-wide default, so "inherit" can say what it inherits. */
    companyDefault: DepositPolicy | null;
}

/** A policy in one phrase: "20% of the price", "$150.00", or "nothing". */
function describePolicy(
    policy: DepositPolicy | null,
    money: { locale: string; currency: string },
): string {
    if (!policy || policy.type === "none") return m.settings_deposit_company_nothing();
    if (policy.type === "percent") return m.settings_deposit_summary_percent({ percent: policy.percent ?? 0 });
    return formatCents(policy.amountCents ?? 0, money);
}

export function DepositWidget({ serviceId, policy, companyDefault }: DepositWidgetProps) {
    // #106 — a deposit policy decides what the client is charged up front, so
    // the save goes through the guard. The per-service fetcher key is kept: it
    // is what stops one row's pending state leaking into its siblings'.
    const { fetcher, submit, busy } = useGuardedSubmit<typeof action>({ key: `deposit-${serviceId}` });
    const [open, setOpen] = useState(false);
    const [choice, setChoice] = useState<DepositChoice>(depositChoiceOf(policy));
    const [percentText, setPercentText] = useState(
        policy?.type === "percent" ? String(policy.percent ?? "") : "",
    );
    const [amountCents, setAmountCents] = useState<number | null>(
        policy?.type === "fixed" ? (policy.amountCents ?? null) : null,
    );
    // Eager-after-error: quiet until a save is attempted, live from then on.
    const [attempted, setAttempted] = useState(false);

    const money = { locale: useDisplayLocale(), currency: useDisplayCurrency() };
    const result = fetcher.state === "idle" ? fetcher.data : undefined;
    const serverError =
        result && "intent" in result && "ok" in result && result.intent === "deposit-policy-save" && result.ok === false
            ? ((result as { message?: string }).message ?? m.settings_deposit_error_save())
            : null;

    const parsed = depositPolicyFromChoice({ choice, percentText, amountCents });
    const localError = attempted && !parsed.ok
        ? parsed.field === "percent"
            ? m.settings_deposit_error_percent()
            : m.settings_deposit_error_amount()
        : null;

    const summary =
        policy === null
            ? m.settings_deposit_summary_inherit({ value: describePolicy(companyDefault, money) })
            : policy.type === "none"
                ? m.settings_deposit_summary_none()
                : describePolicy(policy, money);

    function save() {
        setAttempted(true);
        // Refused here rather than sent: the API accepts a 0% deposit, and a
        // policy that reads as configured while charging nothing is exactly the
        // half-saved state this control exists to prevent.
        if (!parsed.ok) return;
        const sent = submit(
            {
                intent: "deposit-policy-save",
                serviceId,
                // `null` is "inherit the company default" and `{"type":"none"}`
                // is "charge nothing for this one". Both survive the round trip
                // as themselves; collapsing them re-charges every service the
                // company excused.
                depositPolicy: JSON.stringify(parsed.policy),
            },
            { method: "post" },
        );
        // Only close on a call the guard accepted — closing on a refused second
        // click would hide the panel while nothing had been sent.
        if (sent) setOpen(false);
    }

    return (
        <div className="mt-2">
            {!open ? (
                <div className="flex items-center gap-3">
                    <span className="text-[12px] text-ih-fg-3">
                        <span className="font-medium">{m.settings_deposit_label()}</span> {summary}
                    </span>
                    <button
                        type="button"
                        onClick={() => setOpen(true)}
                        className="text-[12px] font-semibold text-ih-primary-text hover:underline"
                    >
                        {m.settings_deposit_change_link()}
                    </button>
                </div>
            ) : (
                <div className="border border-ih-border rounded-md p-3 space-y-2 bg-ih-bg-muted">
                    <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">
                        {m.settings_deposit_heading()}
                    </p>
                    <p className="text-[12px] text-ih-fg-3">{m.settings_deposit_explain()}</p>

                    <div className="border border-ih-border rounded-md p-2 bg-ih-bg-card space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                            <label className="text-[11px] text-ih-fg-3" htmlFor={`deposit-type-${serviceId}`}>
                                {m.settings_deposit_field_label()}
                            </label>
                            <select
                                id={`deposit-type-${serviceId}`}
                                className={FIELD}
                                value={choice}
                                onChange={(e) => setChoice(e.target.value as DepositChoice)}
                            >
                                <option value="inherit">{m.settings_deposit_type_inherit()}</option>
                                <option value="none">{m.settings_deposit_type_none()}</option>
                                <option value="percent">{m.settings_deposit_type_percent()}</option>
                                <option value="fixed">{m.settings_deposit_type_fixed()}</option>
                            </select>

                            {choice === "percent" && (
                                <div className="flex items-center gap-1">
                                    <input
                                        type="number"
                                        min="1"
                                        max="100"
                                        step="1"
                                        className={`${FIELD} w-20`}
                                        value={percentText}
                                        onChange={(e) => setPercentText(e.target.value)}
                                        aria-label={m.settings_deposit_percent_aria()}
                                    />
                                    <span className="text-[12px] text-ih-fg-3">%</span>
                                </div>
                            )}

                            {choice === "fixed" && (
                                <MoneyInput
                                    cents={amountCents}
                                    onChange={setAmountCents}
                                    className={`${FIELD} w-24`}
                                    ariaLabel={m.settings_deposit_amount_aria()}
                                />
                            )}

                            <button
                                type="button"
                                onClick={save}
                                disabled={busy}
                                className="h-7 px-3 rounded-md bg-ih-primary text-ih-fg-inverse font-bold text-[12px] hover:bg-ih-primary-600 transition-colors disabled:opacity-50"
                            >
                                {busy ? m.common_saving() : m.common_save()}
                            </button>
                            <button
                                type="button"
                                onClick={() => setOpen(false)}
                                className="h-7 px-3 rounded-md border border-ih-border text-[12px] font-medium text-ih-fg-2 hover:bg-ih-bg-muted transition-colors"
                            >
                                {m.common_close()}
                            </button>
                        </div>

                        {/* Inheriting is a real answer, so it says what it means
                            rather than leaving the row looking unfinished. */}
                        {choice === "inherit" && (
                            <p className="text-[11px] text-ih-fg-3">
                                {m.settings_deposit_summary_inherit({ value: describePolicy(companyDefault, money) })}
                            </p>
                        )}
                        {(localError || serverError) && (
                            <p className="text-[12px] text-ih-bad-fg">{localError ?? serverError}</p>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
