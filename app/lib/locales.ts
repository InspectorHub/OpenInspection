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

/** Supported tenant currencies (ISO 4217). */
export const CURRENCY_OPTIONS: { value: string; label: string }[] = [
  { value: "USD", label: "USD — US Dollar" },
];
