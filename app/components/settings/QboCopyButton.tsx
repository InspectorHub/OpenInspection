import { useEffect, useRef, useState } from "react";
import { m } from "~/paraglide/messages";

type CopyState = "idle" | "copied" | "failed";

/**
 * Copies one value and says whether it worked.
 *
 * `navigator.clipboard` exists only in a secure context, and this page is
 * routinely opened over plain http on a local network while someone is setting
 * up their own Intuit app. Calling it there throws a TypeError, so the write is
 * guarded and a refusal is reported as "Copy failed" rather than as nothing.
 */
export function QboCopyButton({ value, label, describedBy }: { value: string; label?: string; describedBy?: string }) {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    let next: CopyState = "copied";
    try {
      if (!navigator.clipboard) throw new Error("no clipboard");
      await navigator.clipboard.writeText(value);
    } catch {
      next = "failed";
    }
    setState(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2000);
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label={label}
      aria-describedby={describedBy}
      className="shrink-0 px-2 py-1 text-[12px] font-bold text-ih-fg-2 hover:bg-ih-bg-muted rounded-md transition-colors"
    >
      <span aria-live="polite">
        {state === "copied" ? m.settings_qbo_copied() : state === "failed" ? m.settings_qbo_copy_failed() : m.settings_qbo_copy()}
      </span>
    </button>
  );
}
