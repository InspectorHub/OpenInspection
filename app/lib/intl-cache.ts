/**
 * Memoised `Intl` formatter constructors.
 *
 * Building an `Intl.DateTimeFormat` loads locale data and resolves the time
 * zone; it costs far more than formatting with one. A list page that formats
 * a few dates per row used to construct three formatters per date. The set of
 * distinct (locale, options) pairs a deployment uses is tiny, so formatters
 * are built once and reused.
 *
 * A formatter is immutable, so sharing one instance is safe. A constructor
 * that throws (for example an unknown time zone) is never cached: the error
 * is raised again on every call, exactly as it was without the cache.
 */

const MAX_ENTRIES = 256;


function stableKey(locale: string | undefined, options: object | undefined): string {
  const entries = options ? Object.entries(options).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)) : [];
  return `${locale ?? ""}|${JSON.stringify(entries)}`;
}

class FormatterCache<T> {
  private readonly entries = new Map<string, T>();

  get(locale: string | undefined, options: object | undefined, build: () => T): T {
    const key = stableKey(locale, options);
    const hit = this.entries.get(key);
    if (hit) return hit;
    const made = build();
    // Bounded: a runaway key space (for instance a per-user option) must not
    // grow without limit. Dropping everything is fine; the next call rebuilds.
    if (this.entries.size >= MAX_ENTRIES) this.entries.clear();
    this.entries.set(key, made);
    return made;
  }

  clear(): void {
    this.entries.clear();
  }
}

const dateTime = new FormatterCache<Intl.DateTimeFormat>();
const number = new FormatterCache<Intl.NumberFormat>();
const relative = new FormatterCache<Intl.RelativeTimeFormat>();

export function cachedDateTimeFormat(locale: string, options?: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return dateTime.get(locale, options, () => new Intl.DateTimeFormat(locale, options));
}

export function cachedNumberFormat(locale: string, options?: Intl.NumberFormatOptions): Intl.NumberFormat {
  return number.get(locale, options, () => new Intl.NumberFormat(locale, options));
}

export function cachedRelativeTimeFormat(locale: string, options?: Intl.RelativeTimeFormatOptions): Intl.RelativeTimeFormat {
  return relative.get(locale, options, () => new Intl.RelativeTimeFormat(locale, options));
}

/** Test seam: forget every cached formatter. */
export function resetIntlCacheForTests(): void {
  dateTime.clear();
  number.clear();
  relative.clear();
}

