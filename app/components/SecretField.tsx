import { useState, useRef, useCallback, useEffect } from "react";

/**
 * Secret UI化 — reusable input field for integration API keys.
 *
 * - Shows masked value (bullet characters) when a secret is already set
 * - Shows "Not configured" placeholder when empty
 * - On focus, clears the mask so the user can type a new value
 * - On blur without changes, restores the original mask
 * - After a successful save, the loader revalidates with a fresh masked value
 *   and the field re-masks itself (typed plaintext never outlives the submit)
 * - The hidden input holds the actual value to submit; the visible input
 *   is just for display/editing
 */
export function SecretField({
  name,
  label,
  value,
  hint,
  error,
  type = "password",
}: {
  name: string;
  label: string;
  /** Masked value from the API (e.g. "re_1••••••••xyz") or "" if not set */
  value: string;
  hint?: string;
  /** Validation error to render under the field (conditional only). */
  error?: string;
  /**
   * Kept for API stability. Masking comes from the server-side masked VALUE,
   * not the input type — plaintext-while-typing is intentional (keys are
   * pasted and need visual confirmation).
   */
  type?: "password" | "text";
}) {
  void type;
  const isSet = value.length > 0;
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Re-mask after save: when the loader revalidates and delivers a fresh
  // masked value, drop the local editing state so the typed plaintext never
  // outlives the submit (it used to stay visible until a full reload).
  useEffect(() => {
    setEditing(false);
    setInputValue("");
  }, [value]);

  const handleFocus = useCallback(() => {
    if (!editing) {
      setEditing(true);
      setInputValue("");
    }
  }, [editing]);

  const handleBlur = useCallback(() => {
    // If the user didn't type anything, revert to masked display
    if (inputValue.trim() === "") {
      setEditing(false);
      setInputValue("");
    }
  }, [inputValue]);

  // The actual value to submit:
  // - If editing and user typed something: the new value
  // - If not editing: empty string (meaning "no change" — server ignores empty)
  const submitValue = editing && inputValue.trim() !== "" ? inputValue : "";

  return (
    <div className="space-y-1">
      <label
        htmlFor={`secret-${name}`}
        className="block text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3"
      >
        {label}
      </label>
      <div className="relative">
        {/* Hidden input carries the actual submit value */}
        <input type="hidden" name={name} value={submitValue} />
        <input
          ref={inputRef}
          id={`secret-${name}`}
          type="text"
          value={editing ? inputValue : (isSet ? value : "")}
          placeholder={isSet ? "" : "Not configured"}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onChange={(e) => setInputValue(e.target.value)}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          className={`w-full h-9 px-3 rounded-md border ${
            error ? "border-ih-bad" : "border-ih-border"
          } bg-ih-bg-card text-[13px] focus:border-ih-primary focus:shadow-ih-focus outline-none transition-all ${
            isSet && !editing
              ? "font-mono text-ih-fg-3"
              : "text-ih-fg-1"
          }`}
        />
        {/* Status indicator */}
        {!editing && (
          <span
            className={`absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold uppercase tracking-widest ${
              isSet ? "text-ih-ok-fg" : "text-ih-fg-4"
            }`}
          >
            {isSet ? "Set" : ""}
          </span>
        )}
      </div>
      {hint && (
        <p className="text-[11px] text-ih-fg-4">{hint}</p>
      )}
      {error && <p className="text-[11px] text-ih-bad-fg">{error}</p>}
    </div>
  );
}
