import React from "react";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  hint?: string;
  /** Render only the raw control (no label/error chrome) for inline composition. */
  bare?: boolean;
  /** Option list. Alternatively pass native <option> children. */
  options?: SelectOption[];
}

/**
 * Design System select. Mirrors Input's chrome (label / error / hint) and the
 * `.ih-input` metrics (36px height, 12px padding, DS border/radius/focus). In
 * single-select mode it hides the native chevron (`appearance-none`) and draws
 * a tokenized chevron, matching the app's existing styled selects
 * (RatingSystemEditor). `multiple` keeps native rendering (a listbox) and drops
 * the chevron affordance.
 */
export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, hint, bare = false, options, className = "", multiple, children, id, ...props }, ref) => {
    const generatedId = React.useId();
    const controlId = id ?? generatedId;

    const optionNodes = options
      ? options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))
      : children;

    const control = (
      <div className="relative">
        <select
          ref={ref}
          id={controlId}
          multiple={multiple}
          className={`ih-input w-full text-ih-fg-1 ${
            multiple ? "!h-auto min-h-[80px] py-1" : "appearance-none pr-8"
          } ${error ? "border-ih-bad" : ""} ${className}`}
          {...props}
        >
          {optionNodes}
        </select>
        {!multiple && (
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            fill="none"
            className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ih-fg-4"
          >
            <path d="M6 8l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
    );

    if (bare) return control;

    return (
      <div>
        {label && (
          <label htmlFor={controlId} className="block text-xs font-bold text-ih-fg-2 mb-1">
            {label}
          </label>
        )}
        {control}
        {error && <p className="text-[11px] text-ih-bad-fg mt-1">{error}</p>}
        {!error && hint && <p className="text-[11px] text-ih-fg-4 mt-1">{hint}</p>}
      </div>
    );
  },
);
Select.displayName = "Select";
