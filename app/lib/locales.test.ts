import { describe, expect, it } from "vitest";
import { LOCALE_OPTIONS, localeLabel, localeShortLabel, storedLocaleTag } from "./locales";
import { SUPPORTED_CONTACT_LOCALES } from "../../server/lib/i18n/contact-locale";

/**
 * Three tables have to agree about what languages exist: the compiled catalogue
 * (`SUPPORTED_CONTACT_LOCALES`), the settings pickers' stored tags
 * (`LOCALE_OPTIONS`), and the switcher's short labels. They are separate on
 * purpose — the catalogue is a build artifact, the stored tags are BCP-47, and
 * the labels are copy — but a language present in one and missing from another
 * shows up as an empty segment or a preference that will not stick, never as an
 * error. Asserted here rather than left to a comment saying "keep in sync".
 */
describe("the locale tables agree", () => {
  it("offers a stored tag for every locale the catalogue is compiled for", () => {
    for (const locale of SUPPORTED_CONTACT_LOCALES) {
      const stored = storedLocaleTag(locale);
      expect(LOCALE_OPTIONS.map((o) => o.value)).toContain(stored);
    }
  });

  it("gives every offered locale a short label distinct from the raw tag", () => {
    for (const option of LOCALE_OPTIONS) {
      const short = localeShortLabel(option.value);
      // Falling through to the tag is the failure mode: it renders 'es-419' as
      // a segment label, which names a UN region code rather than a language.
      expect(short).not.toBe(option.value);
      expect(short.length).toBeGreaterThan(0);
    }
  });

  it("names languages in their own language, not the reader's", () => {
    // Someone who cannot read the current interface language has to be able to
    // find their own — an all-English list defeats the control entirely.
    expect(localeShortLabel("es-419")).toBe("Español");
    expect(localeShortLabel("en")).toBe("English");
  });
});

describe("storedLocaleTag", () => {
  it("maps a Paraglide tag onto the tag the settings picker stores", () => {
    // 'en' is what the cookie and the catalogue call it; 'en-US' is what
    // users.locale holds. Persisting 'en' would leave the Profile <select> with
    // no matching option, so it would read as "Use workspace default".
    expect(storedLocaleTag("en")).toBe("en-US");
    expect(storedLocaleTag("es-419")).toBe("es-419");
  });

  it("is idempotent, so a stored tag round-trips unchanged", () => {
    for (const option of LOCALE_OPTIONS) {
      expect(storedLocaleTag(storedLocaleTag(option.value))).toBe(option.value);
    }
  });

  it("hands back an unknown tag rather than inventing a language", () => {
    expect(storedLocaleTag("fr-FR")).toBe("fr-FR");
  });
});

describe("localeShortLabel vs localeLabel", () => {
  it("drops the region qualifier the popover has no room for", () => {
    // The long label stays available for the settings <select>, where one row
    // per stored tag means the region is the disambiguator.
    expect(localeLabel("es-419")).toContain("Latinoam");
    expect(localeShortLabel("es-419")).not.toContain("(");
  });

  it("falls back to the long label for a language with no short one", () => {
    expect(localeShortLabel("fr-FR")).toBe(localeLabel("fr-FR"));
  });
});
