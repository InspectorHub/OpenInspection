import React from "react";

export interface RadioOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface RadioProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

/**
 * A single Design System radio, wrapped in its own <label> for native
 * association. Exported for custom layouts; for the common case use RadioGroup.
 */
export const Radio = React.forwardRef<HTMLInputElement, RadioProps>(
  ({ label, className = "", ...props }, ref) => (
    <label className="flex items-center gap-2 cursor-pointer">
      <input ref={ref} type="radio" className={`accent-ih-primary h-4 w-4 ${className}`} {...props} />
      {label && <span className="text-[13px] text-ih-fg-2">{label}</span>}
    </label>
  ),
);
Radio.displayName = "Radio";

interface RadioGroupProps {
  name: string;
  value: string;
  onChange: (value: string) => void;
  options: RadioOption[];
  legend?: string;
  error?: string;
  hint?: string;
  className?: string;
}

/**
 * Design System radio group rendered as a <fieldset>/<legend> with
 * role=radiogroup for accessibility. Each option shares the group `name`; the
 * option whose value matches `value` is checked. `onChange` receives the raw
 * option value (not the event), matching the app's controlled-select ergonomics.
 */
export function RadioGroup({
  name,
  value,
  onChange,
  options,
  legend,
  error,
  hint,
  className = "",
}: RadioGroupProps) {
  return (
    <fieldset role="radiogroup" className={className}>
      {legend && (
        <legend className="block text-xs font-bold text-ih-fg-2 mb-1">{legend}</legend>
      )}
      <div className="flex flex-col gap-1.5">
        {options.map((o) => (
          <Radio
            key={o.value}
            name={name}
            value={o.value}
            label={o.label}
            disabled={o.disabled}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
          />
        ))}
      </div>
      {error && <p className="text-[11px] text-ih-bad-fg mt-1">{error}</p>}
      {!error && hint && <p className="text-[11px] text-ih-fg-4 mt-1">{hint}</p>}
    </fieldset>
  );
}
