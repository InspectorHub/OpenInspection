import { useState } from "react";
import { SegmentedControl } from "@core/shared-ui";
import { MoneyInput } from "~/components/MoneyInput";
import {
  depositChoiceOf,
  depositPolicyFromChoice,
  type DepositChoice,
} from "~/lib/deposit-policy-form";
import type { DepositPolicy } from "../../../server/lib/billing/deposit-policy";
import type { action } from "~/routes/settings-booking";
import { useGuardedSubmit } from "~/hooks/useGuardedSubmit";
import { m } from "~/paraglide/messages";

interface TenantConfig {
  conciergeReviewRequired: boolean;
  blockUnsignedAgreement: boolean;
  allowInspectorChoice: boolean;
  /** The company-wide deposit. NULL is where every company starts: no deposit. */
  depositPolicy: DepositPolicy | null;
}

export function BookingPoliciesPanel({ initialConfig }: { initialConfig: TenantConfig }) {
  // #106 - user mutation: saves the tenant-wide booking policy.
  const { fetcher, submit, busy: saving } = useGuardedSubmit<typeof action>();
  const [concierge, setConcierge] = useState(initialConfig.conciergeReviewRequired);
  const [blockUnsigned, setBlockUnsigned] = useState(initialConfig.blockUnsignedAgreement);
  const [allowChoice, setAllowChoice] = useState(initialConfig.allowInspectorChoice);
  const [dirty, setDirty] = useState(false);

  // A deposit is not a checkbox, but it IS a booking policy, so it lives in this
  // panel under the same Save. The company default has three answers only —
  // `inherit` belongs to a service, which has something to inherit FROM.
  const stored = initialConfig.depositPolicy;
  const [depositChoice, setDepositChoice] = useState<DepositChoice>(
    stored ? depositChoiceOf(stored) : "none",
  );
  const [percentText, setPercentText] = useState(
    stored?.type === "percent" ? String(stored.percent ?? "") : "",
  );
  const [amountCents, setAmountCents] = useState<number | null>(
    stored?.type === "fixed" ? (stored.amountCents ?? null) : null,
  );
  // Eager-after-error: silent until a save is attempted, live from then on.
  const [attempted, setAttempted] = useState(false);
  const depositResult = depositPolicyFromChoice({ choice: depositChoice, percentText, amountCents });
  const depositError = attempted && !depositResult.ok
    ? depositResult.field === "percent"
      ? m.settings_deposit_error_percent()
      : m.settings_deposit_error_amount()
    : null;

  const saved =
    fetcher.state === "idle" &&
    fetcher.data?.intent === "policies-save" &&
    fetcher.data.ok === true &&
    !dirty;

  const failed =
    fetcher.state === "idle" &&
    fetcher.data?.intent === "policies-save" &&
    fetcher.data.ok === false &&
    !dirty;

  function handleSave() {
    setAttempted(true);
    // Refused here rather than sent: the API accepts a 0% deposit, and a policy
    // that reads as configured while charging nothing is the half-saved state
    // this control exists to make impossible.
    if (!depositResult.ok) return;
    // The company default has no "opted out of itself" state: its No deposit
    // clears the column, which is also where every company already is.
    const policy = depositResult.policy?.type === "none" ? null : depositResult.policy;
    setDirty(false);
    submit(
      {
        intent: "policies-save",
        conciergeReviewRequired: String(concierge),
        blockUnsignedAgreement: String(blockUnsigned),
        allowInspectorChoice: String(allowChoice),
        depositPolicy: JSON.stringify(policy),
      },
      { method: "post" },
    );
  }

  return (
    <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-4">
      <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">{m.settings_policies_heading()}</h3>

      <label className="flex items-start gap-3 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={concierge}
          onChange={(e) => { setConcierge(e.target.checked); setDirty(true); }}
          className="mt-0.5 h-4 w-4 rounded border-ih-border text-ih-primary"
        />
        <span>
          <span className="block text-[13px] font-bold text-ih-fg-1">{m.settings_policies_concierge_label()}</span>
          <span className="block text-[12px] text-ih-fg-3 mt-0.5">
            {m.settings_policies_concierge_desc()}
          </span>
        </span>
      </label>

      <label className="flex items-start gap-3 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={blockUnsigned}
          onChange={(e) => { setBlockUnsigned(e.target.checked); setDirty(true); }}
          className="mt-0.5 h-4 w-4 rounded border-ih-border text-ih-primary"
        />
        <span>
          <span className="block text-[13px] font-bold text-ih-fg-1">{m.settings_policies_signed_label()}</span>
          <span className="block text-[12px] text-ih-fg-3 mt-0.5">
            {m.settings_policies_signed_desc()}
          </span>
          {/* The gate is order-wide, and that is the part an operator finds out
              the hard way otherwise: an add-on's unsigned addendum holding back
              a report that is finished. Stated here rather than discovered. */}
          {blockUnsigned && (
            <span className="block text-[12px] text-ih-watch-fg mt-1">
              {m.settings_policies_signed_scope()}
            </span>
          )}
        </span>
      </label>

      <label className="flex items-start gap-3 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={allowChoice}
          onChange={(e) => { setAllowChoice(e.target.checked); setDirty(true); }}
          className="mt-0.5 h-4 w-4 rounded border-ih-border text-ih-primary"
        />
        <span>
          <span className="block text-[13px] font-bold text-ih-fg-1">{m.settings_policies_choice_label()}</span>
          <span className="block text-[12px] text-ih-fg-3 mt-0.5">
            {m.settings_policies_choice_desc()}
          </span>
        </span>
      </label>

      {/* Not a checkbox, so it cannot be a fourth row of them — but it is a
          booking policy, and a panel of policies that omits the one that takes
          money would send an admin looking for a page that does not exist. */}
      <div className="border-t border-ih-border pt-4 space-y-2">
        <span className="block text-[13px] font-bold text-ih-fg-1">{m.settings_policies_deposit_label()}</span>
        <span className="block text-[12px] text-ih-fg-3">{m.settings_policies_deposit_desc()}</span>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          {/* Buttons, not inputs: this control carries no hidden field, so its
              value reaches the server only because handleSave sends the state
              it owns. Never put it in a native form and expect a submission. */}
          <SegmentedControl
            ariaLabel={m.settings_policies_deposit_aria()}
            size="md"
            options={[
              { value: "none", label: m.settings_policies_deposit_type_none() },
              { value: "percent", label: m.settings_policies_deposit_type_percent() },
              { value: "fixed", label: m.settings_policies_deposit_type_fixed() },
            ]}
            value={depositChoice}
            onChange={(v) => { setDepositChoice(v as DepositChoice); setDirty(true); }}
          />

          {depositChoice === "percent" && (
            <div className="flex items-center gap-1">
              <input
                type="number"
                min="1"
                max="100"
                step="1"
                className="h-8 w-20 px-2 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:outline-none focus:ring-2 focus:ring-ih-primary"
                value={percentText}
                onChange={(e) => { setPercentText(e.target.value); setDirty(true); }}
                aria-label={m.settings_deposit_percent_aria()}
              />
              <span className="text-[13px] text-ih-fg-3">%</span>
            </div>
          )}

          {depositChoice === "fixed" && (
            <MoneyInput
              cents={amountCents}
              onChange={(c) => { setAmountCents(c); setDirty(true); }}
              className="h-8 w-28 px-2 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:outline-none focus:ring-2 focus:ring-ih-primary"
              ariaLabel={m.settings_deposit_amount_aria()}
            />
          )}
        </div>

        {/* Off is a state, not an empty field. Every company starts here, and
            saying so is the difference between "nothing is charged" and "this
            looks unfinished". */}
        {depositChoice === "none" && (
          <p className="text-[12px] text-ih-fg-3">{m.settings_policies_deposit_off()}</p>
        )}
        {depositChoice !== "none" && (
          <p className="text-[12px] text-ih-fg-3">{m.settings_policies_deposit_service_note()}</p>
        )}
        {depositError && <p className="text-[12px] text-ih-bad-fg">{depositError}</p>}
      </div>

      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="h-8 px-3 rounded-md bg-ih-primary text-ih-fg-inverse font-bold text-[12px] hover:bg-ih-primary-600 transition-colors disabled:opacity-50"
        >
          {saving ? m.settings_holiday_save_pending() : m.settings_policies_save()}
        </button>
        {saved && <span className="text-[13px] text-ih-ok-fg font-bold">{m.settings_holiday_saved()}</span>}
        {failed && (
          <span className="text-[13px] text-ih-bad-fg font-bold">
            {fetcher.data?.message ?? m.settings_holiday_save_failed()}
          </span>
        )}
      </div>
    </section>
  );
}
