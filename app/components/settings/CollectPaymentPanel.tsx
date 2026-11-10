import { useState } from "react";
import { Link } from "react-router";
import { Button, SegmentedControl, buttonClasses } from "@core/shared-ui";
import { MoneyInput } from "@core/field-ui/components/MoneyInput";
import { formatCurrency } from "@core/field-ui/shared/format";
import {
  FULL_FEE_POLICY,
  depositPolicyFromChoice,
  depositPresetOf,
  type DepositChoice,
} from "~/lib/deposit-policy-form";
import type { StripeStatus } from "~/lib/settings/stripe-status";
import type { DepositPolicy } from "../../../server/lib/billing/deposit-policy";
import type { action } from "~/routes/settings-booking";
import { useGuardedSubmit } from "~/hooks/useGuardedSubmit";
import { useDisplayLocale } from "~/hooks/useSessionContext";
import { m } from "~/paraglide/messages";

/**
 * "Collect payment when clients book": the company-wide deposit, with the one
 * question an owner cannot answer from the deposit alone (can a card actually be
 * taken?) stated beside it.
 *
 * It owns its own save (`deposit-save`) and only ever sends `depositPolicy`, so it
 * cannot flip the checkbox policies below it. The status lines read the PROPS, not
 * local state: what is shown is what the server last stored, after the loader
 * revalidates, never what the person is half way through typing.
 *
 * Turning a deposit on with Stripe missing is allowed and says so. The booking
 * is still accepted, the deposit is recorded as owed, and the client is told the
 * company will be in touch; refusing the save would only hide a state the owner
 * can fix by adding the keys afterwards.
 */
export function CollectPaymentPanel({
  depositPolicy,
  stripe,
  currency = "USD",
}: {
  /** `undefined` is "not visible to this caller", which is not the same as `null` (off). */
  depositPolicy: DepositPolicy | null | undefined;
  stripe: StripeStatus;
  currency?: string;
}) {
  const { fetcher, submit, busy: saving } = useGuardedSubmit<typeof action>();
  const locale = useDisplayLocale();
  const preset = depositPresetOf(depositPolicy);

  // The editor is for the partial answers. Full fee and off are one click each.
  const [editing, setEditing] = useState(preset === "custom");
  const [choice, setChoice] = useState<DepositChoice>(depositPolicy?.type === "fixed" ? "fixed" : "percent");
  const [percentText, setPercentText] = useState(
    depositPolicy?.type === "percent" && preset === "custom" ? String(depositPolicy.percent ?? "") : "",
  );
  const [amountCents, setAmountCents] = useState<number | null>(
    depositPolicy?.type === "fixed" ? (depositPolicy.amountCents ?? null) : null,
  );
  // Eager-after-error: silent until a save is attempted, live from then on.
  const [attempted, setAttempted] = useState(false);
  const result = depositPolicyFromChoice({ choice, percentText, amountCents });
  const error = attempted && !result.ok
    ? result.field === "percent" ? m.settings_collect_error_percent() : m.settings_collect_error_amount()
    : null;

  const answered = fetcher.state === "idle" && fetcher.data?.intent === "deposit-save";
  const saved = answered && fetcher.data?.ok === true;
  const failed = answered && fetcher.data?.ok === false;

  // Exactly one of the two presets reads as chosen. Opening the editor takes the
  // selection from "full" even though the stored policy is still the full fee.
  const fullSelected = preset === "full" && !editing;
  const depositSelected = editing || preset === "custom";

  function send(policy: DepositPolicy | null) {
    // The company default has no "opted out of itself" state: off clears the column.
    submit({ intent: "deposit-save", depositPolicy: JSON.stringify(policy) }, { method: "post" });
  }

  function chooseFull() {
    setEditing(false);
    send(FULL_FEE_POLICY);
  }

  function chooseOff() {
    setEditing(false);
    send(null);
  }

  function saveDeposit() {
    setAttempted(true);
    // Refused here rather than sent: the API accepts a 0% deposit, and a policy
    // that reads as configured while charging nothing is the half-saved state.
    if (!result.ok) return;
    send(result.policy);
  }

  // The branding endpoint omits the deposit for a caller without company-finance
  // access. Reading that as "off" would offer a button the server then refuses,
  // so the section says whose setting it is and offers nothing to press.
  if (depositPolicy === undefined) {
    return (
      <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-2 mb-ih-list">
        <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">{m.settings_collect_heading()}</h3>
        <p className="text-[13px] text-ih-fg-2" data-testid="collect-owner-managed">{m.settings_collect_owner_managed()}</p>
      </section>
    );
  }

  const statusText =
    preset === "off" ? m.settings_collect_status_off()
    : preset === "full" ? m.settings_collect_status_full()
    : depositPolicy?.type === "fixed"
      ? m.settings_collect_status_fixed({ amount: formatCurrency(depositPolicy.amountCents ?? 0, { locale, currency }) })
      : m.settings_collect_status_percent({ percent: String(depositPolicy?.percent ?? 0) });

  const stripeText =
    stripe === "connected" ? m.settings_collect_stripe_connected()
    : stripe === "attention" ? m.settings_collect_stripe_incomplete()
    : stripe === "not_connected" ? m.settings_collect_stripe_missing()
    : m.settings_collect_stripe_unknown();
  const stripeOk = stripe === "connected";

  return (
    <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-4 mb-ih-list">
      <div className="space-y-1">
        <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">{m.settings_collect_heading()}</h3>
        <p className="text-[12px] text-ih-fg-3">{m.settings_collect_intro()}</p>
      </div>

      <dl className="space-y-2 text-[13px]">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <dt className="font-bold text-ih-fg-1">{m.settings_collect_stripe_label()}</dt>
          <dd className={stripeOk ? "text-ih-ok-fg font-bold" : "text-ih-watch-fg font-bold"}>{stripeText}</dd>
          {!stripeOk && (
            <dd>
              <Link to="/settings/integrations#stripe" className={buttonClasses({ variant: "link", size: "sm" })}>
                {m.settings_collect_stripe_link()}
              </Link>
            </dd>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <dt className="font-bold text-ih-fg-1">{m.settings_collect_deposits_label()}</dt>
          <dd className={preset === "off" ? "text-ih-fg-3" : "text-ih-fg-1 font-bold"} data-testid="collect-status">{statusText}</dd>
        </div>
      </dl>


      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          selected={fullSelected}
          pending={saving}
          onClick={chooseFull}
          className="w-full sm:w-auto"
        >
          {m.settings_collect_preset_full()}
        </Button>
        <Button
          variant="secondary"
          selected={depositSelected}
          pending={saving}
          onClick={() => setEditing(true)}
          className="w-full sm:w-auto"
        >
          {m.settings_collect_preset_deposit()}
        </Button>
        {preset !== "off" && (
          <Button variant="ghost" pending={saving} onClick={chooseOff} className="w-full sm:w-auto">
            {m.settings_collect_preset_off()}
          </Button>
        )}
      </div>

      {editing && (
        <div className="space-y-2 border-t border-ih-border pt-4">
          <div className="flex flex-wrap items-center gap-3">
            {/* Buttons, not inputs: this control carries no hidden field, so its
                value reaches the server only because saveDeposit sends the state
                it owns. */}
            <SegmentedControl
              ariaLabel={m.settings_collect_kind_aria()}
              size="md"
              options={[
                { value: "percent", label: m.settings_collect_kind_percent() },
                { value: "fixed", label: m.settings_collect_kind_fixed() },
              ]}
              value={choice}
              onChange={(v) => setChoice(v as DepositChoice)}
            />
            {choice === "percent" && (
              <div className="flex items-center gap-1">
                <input
                  type="number" inputMode="numeric" min="1" max="100" step="1"
                  className="h-8 w-20 px-2 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:outline-none focus:ring-2 focus:ring-ih-primary"
                  value={percentText}
                  onChange={(e) => setPercentText(e.target.value)}
                  aria-label={m.settings_deposit_percent_aria()}
                />
                <span className="text-[13px] text-ih-fg-3">%</span>
              </div>
            )}
            {choice === "fixed" && (
              <MoneyInput
                cents={amountCents}
                onChange={setAmountCents}
                className="h-8 w-28 px-2 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:outline-none focus:ring-2 focus:ring-ih-primary"
                ariaLabel={m.settings_deposit_amount_aria()}
                currency={currency}
                locale={locale}
              />
            )}
            <Button variant="primary" size="sm" pending={saving} onClick={saveDeposit}>
              {saving ? m.settings_holiday_save_pending() : m.settings_collect_save()}
            </Button>
          </div>
          {error && <p className="text-[12px] text-ih-bad-fg">{error}</p>}
          <p className="text-[12px] text-ih-fg-3">{m.settings_policies_deposit_service_note()}</p>
        </div>
      )}

      {/* Persistent and empty on first paint: a live region that arrives together
          with its text is often not announced, one that already exists is. */}
      <div role="status" aria-live="polite" data-testid="collect-live" className="space-y-2">
        {preset !== "off" && !stripeOk && (
          <p className="rounded-md bg-ih-watch-bg px-3 py-2 text-[12px] font-semibold text-ih-watch-fg" data-testid="collect-warning">
            {m.settings_collect_warn_no_stripe()}
          </p>
        )}
        {saved && <p className="text-[13px] text-ih-ok-fg font-bold" data-testid="collect-saved">{m.settings_holiday_saved()}</p>}
        {failed && (
          <p className="text-[13px] text-ih-bad-fg font-bold" data-testid="collect-failed">{fetcher.data?.message ?? m.settings_holiday_save_failed()}</p>
        )}
      </div>
    </section>
  );
}
