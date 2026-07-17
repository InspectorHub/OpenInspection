/**
 * BCP-47 locale resolution, sibling to server/lib/tz.ts. A single locale drives
 * date/time/number formatting and (later) UI language. Validation is delegated
 * to the runtime's Intl database; fail-safe default 'en-US'.
 */

/** True when `raw` is a structurally valid, canonicalizable BCP-47 tag. */
export function isValidLocale(raw: string): boolean {
  if (!raw) return false;
  try {
    // Throws RangeError on malformed tags.
    return new Intl.Locale(raw).toString().length > 0;
  } catch {
    return false;
  }
}

/** The stored locale if valid, else 'en-US' (fail-safe; existing-tenant default). */
export function resolveLocale(raw: string | null | undefined): string {
  return raw && isValidLocale(raw) ? raw : 'en-US';
}
