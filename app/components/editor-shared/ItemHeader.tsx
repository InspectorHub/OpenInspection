import { m } from "~/paraglide/messages";

export interface ItemHeaderProps {
  /** Zero-padded item index (template card) — e.g. "01". Omit in the editor header. */
  number?: string;
  label: string;
  required?: boolean;
  isSafety?: boolean;
  /** "sm" = template item card (13px/medium); "lg" = inspection editor h2 (19px/bold). */
  size?: "sm" | "lg";
  className?: string;
  /** Render as a different HTML element for a11y (e.g. "h2" when the site uses a heading).
   *  Default: "div". */
  as?: "div" | "h1" | "h2" | "h3" | "h4";
}

/** Shared item title line (spec §3.3): number + label + required/safety badges. */
export function ItemHeader({ number, label, required, isSafety, size = "sm", className, as = "div" }: ItemHeaderProps) {
  const Tag = as;
  // `lg` (inspection editor heading) wraps long labels like the original <h2>;
  // `sm` (template item card) truncates to one line in its narrow card.
  const labelClass = size === "lg" ? "text-[19px] font-bold" : "truncate text-[13px] font-medium";
  return (
    <Tag className={`flex items-center gap-2 min-w-0${className ? ` ${className}` : ""}`}>
      {number && <span className="text-[10px] font-mono text-ih-fg-4 w-5">{number}</span>}
      <span className={labelClass}>{label}</span>
      {required && (
        <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-ih-bad-bg text-ih-bad-fg">
          {m.editor_shared_badge_required()}
        </span>
      )}
      {isSafety && (
        <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-ih-bad-bg text-ih-bad-fg">
          {m.editor_shared_badge_safety()}
        </span>
      )}
    </Tag>
  );
}
