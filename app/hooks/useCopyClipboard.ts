import { useState } from "react";

/**
 * Copy-to-clipboard with transient "copied" feedback that clears after
 * `resetMs` (default 2s).
 *
 * `copied` is the key of the last-copied target (or `null`). Pass a `key` to
 * `copy()` when a surface has multiple copy buttons and needs to highlight only
 * the one that was clicked; omit it for a single button (defaults to "default",
 * so `copied !== null` is the "just copied" flag).
 */
export function useCopyClipboard(resetMs = 2000): {
  copied: string | null;
  copy: (value: string, key?: string) => void;
} {
  const [copied, setCopied] = useState<string | null>(null);
  function copy(value: string, key = "default") {
    void navigator.clipboard.writeText(value);
    setCopied(key);
    setTimeout(() => setCopied(null), resetMs);
  }
  return { copied, copy };
}
