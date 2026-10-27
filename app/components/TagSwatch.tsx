import { safeCssColor } from "@core/field-ui/lib/readable-text";

/** A tag's colour dot. The colour is tenant data, so only a plain colour (a hex, a CSS name) is painted; otherwise there is no dot. */
export function TagSwatch({ color, className = "" }: { color: string | null | undefined; className?: string }) {
  const safe = safeCssColor(color);
  return safe ? <span className={`w-3 h-3 rounded-full ${className}`.trim()} style={{ backgroundColor: safe }} /> : null;
}
