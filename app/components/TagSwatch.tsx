import { safeCssColor } from "@core/field-ui/lib/readable-text";

/** A tag's colour dot, with a hairline ring so a dark colour stays visible on a dark surface (and a pale one on a light surface).  The colour is tenant data, so only a plain colour (a hex, a CSS name) is painted; otherwise there is no dot. */
export function TagSwatch({ color, className = "" }: { color: string | null | undefined; className?: string }) {
  const safe = safeCssColor(color);
  return safe ? <span className={`w-3 h-3 shrink-0 rounded-full ring-1 ring-ih-border ${className}`.trim()} style={{ backgroundColor: safe }} /> : null;
}
