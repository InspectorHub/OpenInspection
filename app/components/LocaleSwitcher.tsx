import { useRouteLoaderData } from "react-router";
import { SegmentedControl, type SegmentedControlOption } from "@core/shared-ui";
import { SUPPORTED_CONTACT_LOCALES, normalizeLocale } from "../../server/lib/i18n/contact-locale";
import { localeShortLabel, storedLocaleTag } from "~/lib/locales";
import { writeUiLocaleCookie } from "~/lib/ui-prefs";
import { useGuardedSubmit } from "~/hooks/useGuardedSubmit";
import { m } from "~/paraglide/messages";

/**
 * The always-reachable language control (#269).
 *
 * Two pickers already persist a language — Settings → Profile writes
 * `users.locale`, Settings → Workspace writes `tenant_configs.default_locale`.
 * Neither is reachable from the page you are on, and, more to the point,
 * neither is reachable by someone who cannot read the English word "Settings".
 * This is the one control a person can find when the interface is in a language
 * they do not speak, which is why it sits beside the theme control in the user
 * menu rather than on a settings page.
 *
 * Deliberately built on the same `SegmentedControl` as `ThemeSegmentControl`,
 * next to which it renders: a bespoke dropdown here would be the third language
 * control in the app and the only one shaped unlike its own neighbour.
 *
 * TWO WRITES, and both are needed:
 *
 *  1. The COOKIE, written first and synchronously. The worker resolves the
 *     render locale from it before the router runs (`withResolvedUiLocale`), so
 *     this is what makes the change take effect on the very next request rather
 *     than after a database round trip.
 *  2. `users.locale`, through the existing profile action, so the choice
 *     survives a new device — and so `auth-layout`'s stamp, which ranks the
 *     stored preference ABOVE the cookie, agrees with it instead of correcting
 *     it back on the next navigation.
 *
 * The re-render is a consequence of (2), not a separate mechanism: React Router
 * revalidates every loader after a fetcher submission, so the root loader re-runs
 * server-side inside the new request's paraglide scope and the whole tree — plus
 * `<html lang>` — comes back in the new language. No reload, no flash.
 */
export function LocaleSwitcher({ className }: { className?: string }) {
  // Root loader data, exactly as ThemeSegmentControl reads the color scheme:
  // it is the locale the SERVER rendered this page in, so the control always
  // shows what the reader is actually looking at rather than what was last
  // clicked. Absent while the error boundary renders — fall back to English.
  const rootData = useRouteLoaderData("root") as { locale?: string } | undefined;
  const current = normalizeLocale(rootData?.locale) ?? "en";
  // #106 - user mutation: writes the account's stored locale. The cookie is
  // written client-side on the same click and the whole app re-renders in the
  // new language immediately, so the request has nothing left to wait for.
  // submit-guard-allow-no-busy: the UI has already changed before the request goes out.
  const { submit } = useGuardedSubmit();

  // Built at render time (not a module const) so `m.*()` resolves inside the
  // paraglide request scope — same reason ThemeSegmentControl builds its own.
  //
  // The option LABELS come from the locale table, not from message keys: a
  // language name is not translated ("Español" is Español in every language),
  // and a per-locale key would let the two catalogues disagree about what a
  // language is called.
  const options: SegmentedControlOption[] = SUPPORTED_CONTACT_LOCALES.map((value) => ({
    value,
    label: localeShortLabel(value),
  }));

  return (
    <SegmentedControl
      options={options}
      value={current}
      ariaLabel={m.nav_language_aria()}
      className={className}
      onChange={(next) => {
        if (next === current) return;
        writeUiLocaleCookie(next);
        submit(
          { intent: "set-locale", locale: storedLocaleTag(next) },
          { method: "post", action: "/settings/profile" },
        );
      }}
    />
  );
}
