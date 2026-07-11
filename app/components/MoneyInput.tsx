import { useState } from "react";
import { formatDollars, parseCurrencyToCents } from "~/lib/money";

/**
 * Reusable currency input. Money is stored as integer **cents**; the user only
 * ever sees and types **dollars** — no manual cents conversion. Input is
 * tolerant: `8500`, `8,500`, or `$8,500.50` all parse (thousands commas, a `$`
 * prefix and an optional decimal are accepted). While focused the field shows
 * the raw editable string so typing never fights a mid-keystroke reformat;
 * on blur it renders the `$X,XXX` (or `$X,XXX.XX`) display form.
 *
 * There was no shared money-input in the codebase (only the generic shared-ui
 * `Input`), so this lives at the app level. It is the single money-entry
 * control across the app — cost items, inspection price, service catalog &
 * per-inspection overrides, event-type price, invoice amount, repair credits
 * and repair/comment estimate ranges all route through it. For native/Conform
 * forms, pair it with a hidden field carrying `cents / 100` (dollars).
 */
export function MoneyInput({
  id,
  cents,
  onChange,
  onBlur,
  disabled,
  placeholder = "$0",
  className,
  ariaLabel,
}: {
  id?: string;
  cents: number | null;
  onChange: (cents: number | null) => void;
  onBlur?: () => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
}) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState("");

  // Plain, comma-free editable form (e.g. "8500" or "8500.5") seeded on focus.
  const editable = cents == null ? "" : String(cents / 100);
  const display = focused ? draft : cents == null ? "" : formatDollars(cents);

  return (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      aria-label={ariaLabel}
      value={display}
      placeholder={placeholder}
      disabled={disabled}
      className={className}
      onFocus={() => {
        setDraft(editable);
        setFocused(true);
      }}
      onChange={(e) => {
        setDraft(e.target.value);
        onChange(parseCurrencyToCents(e.target.value));
      }}
      onBlur={() => {
        setFocused(false);
        onBlur?.();
      }}
    />
  );
}
