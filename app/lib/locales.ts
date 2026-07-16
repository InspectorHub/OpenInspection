/** Supported UI locales (BCP-47). Kept small + curated (mirrors the tz picker's
 *  intent). Extend as translation coverage grows. */
export const LOCALE_OPTIONS: { value: string; label: string }[] = [
  { value: "en-US", label: "English (US)" },
  { value: "es-419", label: "Español (Latinoamérica)" },
];

/** Supported tenant currencies (ISO 4217). */
export const CURRENCY_OPTIONS: { value: string; label: string }[] = [
  { value: "USD", label: "USD — US Dollar" },
];
