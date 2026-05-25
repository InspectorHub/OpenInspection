import React from "react";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, className = "", ...props }, ref) => (
    <div>
      {label && <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">{label}</label>}
      <input
        ref={ref}
        className={`w-full h-9 px-3 rounded-lg border text-[13px] bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 outline-none ${
          error ? "border-red-500" : "border-slate-200 dark:border-slate-700"
        } ${className}`}
        {...props}
      />
      {error && <p className="text-[11px] text-red-600 mt-1">{error}</p>}
      {!error && hint && <p className="text-[11px] text-slate-400 mt-1">{hint}</p>}
    </div>
  )
);
Input.displayName = "Input";
