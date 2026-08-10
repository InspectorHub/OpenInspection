import { SegmentedControl } from "@core/shared-ui";
import { MoneyInput } from "~/components/MoneyInput";
import type { FeeChoice } from "~/lib/cancellation-policy-form";
import { m } from "~/paraglide/messages";

/**
 * One rung of the cancellation ladder: what is charged, and how much.
 *
 * Extracted because BOTH rungs are the same three answers. A late cancellation
 * and a no-show differ in when they happen, never in how the fee is expressed —
 * so two copies of this markup would be two places for the percent/cents rule to
 * drift, and the whole reason `cancellation-policy-form.ts` keys `type` per rung
 * is that a caller must not be able to apply one rung's unit to the other.
 */

const NUM_FIELD =
  "h-8 w-20 px-2 rounded-md border border-ih-border bg-ih-bg-card text-[13px] " +
  "text-ih-fg-1 focus:outline-none focus:ring-2 focus:ring-ih-primary";
const MONEY_FIELD =
  "h-8 w-28 px-2 rounded-md border border-ih-border bg-ih-bg-card text-[13px] " +
  "text-ih-fg-1 focus:outline-none focus:ring-2 focus:ring-ih-primary";

/** One rung's controls. Both rungs are the same three answers, so both use this. */
export function CancellationFeeRow(props: {
  label: string;
  ariaLabel: string;
  choice: FeeChoice;
  percentText: string;
  amountCents: number | null;
  onChoice: (c: FeeChoice) => void;
  onPercent: (s: string) => void;
  onAmount: (c: number | null) => void;
}) {
  return (
    <div className="space-y-2">
      <span className="block text-[13px] font-bold text-ih-fg-1">{props.label}</span>
      <div className="flex flex-wrap items-center gap-3">
        {/* Buttons, not inputs: this control carries no hidden field, so its value
            reaches the server only because `save` sends the state it owns. Never
            put it in a native form and expect a submission to include it. */}
        <SegmentedControl
          ariaLabel={props.ariaLabel}
          size="md"
          options={[
            { value: "none", label: m.settings_cancellation_fee_none() },
            { value: "percent", label: m.settings_cancellation_fee_percent() },
            { value: "fixed", label: m.settings_cancellation_fee_fixed() },
          ]}
          value={props.choice}
          onChange={(v) => props.onChoice(v as FeeChoice)}
        />
        {props.choice === "percent" && (
          <div className="flex items-center gap-1">
            <input
              type="number"
              min="1"
              max="100"
              step="1"
              className={NUM_FIELD}
              value={props.percentText}
              onChange={(e) => props.onPercent(e.target.value)}
              aria-label={`${props.label} — ${m.settings_cancellation_fee_percent()}`}
            />
            <span className="text-[13px] text-ih-fg-3">%</span>
          </div>
        )}
        {props.choice === "fixed" && (
          <MoneyInput
            cents={props.amountCents}
            onChange={props.onAmount}
            className={MONEY_FIELD}
            ariaLabel={`${props.label} — ${m.settings_cancellation_fee_fixed()}`}
          />
        )}
      </div>
    </div>
  );
}

