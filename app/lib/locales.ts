/** Supported UI locales (BCP-47). Kept small + curated (mirrors the tz picker's
 *  intent). Extend as translation coverage grows. */
export const LOCALE_OPTIONS: { value: string; label: string }[] = [
  { value: "en-US", label: "English (US)" },
  { value: "es-419", label: "Español (Latinoamérica)" },
];

/** The language subtag of a BCP-47 tag, lowercased. Split rather than
 *  `Intl.Locale`, which throws on a malformed tag — looking up a label must
 *  never be the thing that breaks a page. */
function languageOf(tag: string): string {
  return tag.split("-")[0].toLowerCase();
}

/**
 * The display label for a locale, matched by LANGUAGE subtag so `en` and
 * `en-US` resolve to the same entry: a contact's stored preference carries no
 * region while the settings picker's values do, and two labels for one
 * language would read as two different choices. Unknown tags return the tag.
 *
 * The labels are written in their OWN language on purpose. Someone who cannot
 * read English cannot find an option labelled in English.
 */
export function localeLabel(tag: string): string {
  const language = languageOf(tag);
  return LOCALE_OPTIONS.find((o) => languageOf(o.value) === language)?.label ?? tag;
}

/**
 * Short labels for the always-reachable language switcher (#269).
 *
 * The full labels above name the REGION as well, because the settings <select>
 * offers one row per stored tag and "Español" alone would not say which Spanish
 * is stored. The switcher is a two-segment control in a 220px popover, where
 * the region qualifier does not fit and answers a question nobody is asking
 * mid-task: there is exactly one Spanish to switch to.
 *
 * Keyed by LANGUAGE subtag for the same reason `localeLabel` matches that way —
 * the cookie holds a Paraglide tag ('en'), the settings picker holds a stored
 * tag ('en-US'), and both must find the same row. Falls back to the full label
 * (and through it to the raw tag) so an unlisted locale still renders SOMETHING
 * rather than an empty segment; `locales.test.ts` asserts every option has one.
 */
const SHORT_LABELS: Record<string, string> = {
  en: "English",
  es: "Español",
};

/** The switcher's label for a locale: short where we have one, else the full
 *  label. Written in the locale's OWN language, like `localeLabel`. */
export function localeShortLabel(tag: string): string {
  return SHORT_LABELS[languageOf(tag)] ?? localeLabel(tag);
}

/**
 * The tag to STORE for a locale the UI resolved to.
 *
 * The two vocabularies differ: the UI and the cookie speak Paraglide tags
 * ('en', 'es-419'), while `users.locale` / `tenant_configs.default_locale` hold
 * what the settings pickers write ('en-US', 'es-419'). Persisting 'en' verbatim
 * would save a value the Profile <select> has no option for, so the page would
 * show "Use workspace default" for a preference the user had just set.
 */
export function storedLocaleTag(tag: string): string {
  const language = languageOf(tag);
  return LOCALE_OPTIONS.find((o) => languageOf(o.value) === language)?.value ?? tag;
}

/** Supported tenant currencies (ISO 4217). */
export const CURRENCY_OPTIONS: { value: string; label: string }[] = [
  { value: "USD", label: "USD — US Dollar" },
];
