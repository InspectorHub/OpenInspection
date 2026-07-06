import React from "react";

interface CheckboxProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  /** Render only the raw input (no label/error chrome) for inline composition. */
  bare?: boolean;
}

/**
 * Design System checkbox. In labeled (default) mode the input is wrapped in its
 * own <label> (native association, so click-target + a11y come for free) with an
 * optional error line below. In `bare` mode only the input is returned so a
 * parent (e.g. FormField) can supply its own label/error. Uses the DS
 * `accent-ih-primary` token for the check fill.
 */
export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ label, error, bare = false, className = "", id, ...props }, ref) => {
    const input = (
      <input
        ref={ref}
        id={id}
        type="checkbox"
        className={`accent-ih-primary h-4 w-4 ${className}`}
        {...props}
      />
    );

    if (bare) return input;

    return (
      <div>
        <label className="flex items-center gap-2 cursor-pointer">
          {input}
          {label && <span className="text-[13px] text-ih-fg-2">{label}</span>}
        </label>
        {error && <p className="text-[11px] text-ih-bad-fg mt-1">{error}</p>}
      </div>
    );
  },
);
Checkbox.displayName = "Checkbox";
