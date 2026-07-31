import React from "react";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  /** ReactNode, not string: setup-style hints carry a code chip and a docs
   *  link, and stringifying them was the reason that page hand-rolled its
   *  fields instead of using this component. */
  hint?: React.ReactNode;
  /** Keep the error line's height even when there is no error.
   *
   *  For a field that validates on blur — the auth forms — the message
   *  otherwise appears between the input and whatever sits under it and pushes
   *  that thing down mid-click, so a click aimed at "Forgot password?" lands
   *  above the moved link and misses. Off by default: reserving the space on
   *  every field in a dense form would add a blank line under each one. */
  reserveErrorSpace?: boolean;
  /** Rendered under the label, above the input — e.g. a "Forgot password?"
   *  link that belongs to this field rather than to the form. */
  labelAction?: React.ReactNode;
}

// React 19: `ref` is a plain prop, so no forwardRef wrapper.
export function Input({
  label, error, hint, reserveErrorSpace = false, labelAction, className = "", ref, ...props
}: InputProps & { ref?: React.Ref<HTMLInputElement> }) {
  const labelEl = label ? (
    <label htmlFor={props.id} className="block text-xs font-bold text-ih-fg-2 mb-1">{label}</label>
  ) : null;
  return (
    <div>
      {labelAction ? (
        <div className="flex items-center justify-between mb-1">
          {labelEl ? <span className="[&>label]:mb-0">{labelEl}</span> : <span />}
          {labelAction}
        </div>
      ) : labelEl}
      <input
        ref={ref}
        className={`ih-input w-full text-ih-fg-1 placeholder:text-ih-fg-4 ${
          error ? "border-ih-bad" : ""
        } ${className}`}
        {...props}
      />
      {(error || reserveErrorSpace) && (
        <p className={`text-[11px] text-ih-bad-fg mt-1 ${reserveErrorSpace ? "min-h-4" : ""}`} aria-live="polite">
          {error ?? ""}
        </p>
      )}
      {!error && !reserveErrorSpace && hint && <p className="text-[11px] text-ih-fg-4 mt-1">{hint}</p>}
    </div>
  );
}
