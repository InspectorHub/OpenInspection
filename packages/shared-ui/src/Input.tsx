import React from "react";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

// React 19: `ref` is a plain prop, so no forwardRef wrapper.
export function Input({
  label, error, hint, className = "", ref, ...props
}: InputProps & { ref?: React.Ref<HTMLInputElement> }) {
  return (
    <div>
      {label && <label className="block text-xs font-bold text-ih-fg-2 mb-1">{label}</label>}
      <input
        ref={ref}
        className={`ih-input w-full text-ih-fg-1 placeholder:text-ih-fg-4 ${
          error ? "border-ih-bad" : ""
        } ${className}`}
        {...props}
      />
      {error && <p className="text-[11px] text-ih-bad-fg mt-1">{error}</p>}
      {!error && hint && <p className="text-[11px] text-ih-fg-4 mt-1">{hint}</p>}
    </div>
  );
}
