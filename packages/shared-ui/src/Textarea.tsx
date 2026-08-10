import React from "react";

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  hint?: string;
  /** Render only the raw control (no label/error chrome) for inline composition. */
  bare?: boolean;
}

/**
 * Design System multiline text control. Inherits `.ih-input` styling
 * (DS border/radius/background/color/focus) but overrides the fixed 36px height
 * to grow with `rows`, adds vertical padding, and allows vertical resize only.
 */
// React 19: `ref` is a plain prop, so no forwardRef wrapper.
export function Textarea({
  label, error, hint, bare = false, rows = 3, className = "", id, ref, ...props
}: TextareaProps & { ref?: React.Ref<HTMLTextAreaElement> }) {
    const generatedId = React.useId();
    const controlId = id ?? generatedId;

    const control = (
      <textarea
        ref={ref}
        id={controlId}
        rows={rows}
        className={`ih-input w-full text-ih-fg-1 placeholder:text-ih-fg-4 !h-auto py-2 resize-y ${
          error ? "border-ih-bad" : ""
        } ${className}`}
        {...props}
      />
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
        {/* fg-3, not fg-4 — 11px hints are normal-size text (see lint:contrast). */}
        {!error && hint && <p className="text-[11px] text-ih-fg-3 mt-1">{hint}</p>}
      </div>
    );
}
