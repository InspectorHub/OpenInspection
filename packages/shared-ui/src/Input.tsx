import React from "react";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, className = "", ...props }, ref) => (
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
  )
);
Input.displayName = "Input";
