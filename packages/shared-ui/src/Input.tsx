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
      {/* A reserved slot holds the hint and the error in one grid cell and shows one of them, so the slot is
          as tall as the taller of the two: a hint that wraps to two lines is replaced by a one-line error
          without moving the controls below it. */}
      {reserveErrorSpace ? (
        <div className="mt-1 grid min-h-4 text-[11px]" aria-live="polite">
          {hint && (
            <p className={`col-start-1 row-start-1 text-ih-fg-3 ${error ? "invisible" : ""}`}>{hint}</p>
          )}
          <p className={`col-start-1 row-start-1 text-ih-bad-fg ${error ? "" : "invisible"}`}>{error ?? ""}</p>
        </div>
      ) : (
        error && (
          <p className="text-[11px] text-ih-bad-fg mt-1" aria-live="polite">
            {error}
          </p>
        )
      )}
      {/* fg-3, not fg-4: at 11px this is normal-size text and needs 4.5:1.
          fg-4 is 2.56:1 on a light card and 3.07:1 on a dark one. See
          `npm run lint:contrast`. */}
      {!error && !reserveErrorSpace && hint && <p className="text-[11px] text-ih-fg-3 mt-1">{hint}</p>}
    </div>
  );
}
