import { useEffect, useRef, useState } from "react";

export interface InlineRenameProps {
  /** The current name; shown pre-selected so a rename overwrites by default. */
  value: string;
  /** Commit a non-empty, changed name. */
  onCommit: (next: string) => void;
  /** Leave edit mode without changing (Esc, blur-with-empty, or unchanged). */
  onCancel: () => void;
  /** Class list so the input matches the display text it replaces. */
  className?: string;
  ariaLabel?: string;
}

/**
 * Inline rename input shared by the section rail and item list (fill + author).
 *
 * Triggered explicitly (double-click / F2 / the row's ⋯ menu "Rename") — never
 * always-on — so a plain tap still selects the row and a long-press still starts
 * a drag. Standard commit semantics: Enter or blur saves; Esc cancels; an empty
 * or unchanged value reverts. Editor keyboard shortcuts are stopped while typing.
 */
export function InlineRename({ value, onCommit, onCancel, className, ariaLabel }: InlineRenameProps) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  // Guard against blur firing a second commit after Enter/Esc already handled it.
  const doneRef = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const finish = (commit: boolean) => {
    if (doneRef.current) return;
    doneRef.current = true;
    const next = draft.trim();
    if (commit && next && next !== value) onCommit(next);
    else onCancel();
  };

  return (
    <input
      ref={ref}
      value={draft}
      aria-label={ariaLabel}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation(); // don't let editor shortcuts (j/k/f/…) fire while typing
        if (e.key === "Enter") {
          e.preventDefault();
          finish(true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          finish(false);
        }
      }}
      onBlur={() => finish(true)}
      onClick={(e) => e.stopPropagation()} // typing/clicking must not re-select the row
      onPointerDown={(e) => e.stopPropagation()} // …or start a drag
      className={className}
    />
  );
}
