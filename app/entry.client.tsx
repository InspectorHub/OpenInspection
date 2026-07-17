import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";
import {
  overwriteGetLocale,
  extractLocaleFromCookie,
  baseLocale,
} from "~/paraglide/runtime";

// i18n — make the client-side getLocale() PURE before React hydrates.
//
// Paraglide's default getLocale() self-initializes on its FIRST client call:
// it runs setLocale(resolved, { reload: false }) exactly once (inlang #455).
// Every compiled message function (m.*()) calls getLocale() internally, so the
// first m.*() rendered on the client would fire that setLocale side effect
// *during* React render/hydration — which silently breaks React Router's client
// router and fetcher actions (SPA navigation + form saves stop working, while a
// full-page SSR load still looks fine). Phase C only messaged the login page (a
// full-page entry that never exercises SPA nav), so it never surfaced; Rollout 3
// messages the authenticated app shell, which does.
//
// Installing a side-effect-free resolver here — before hydrateRoot — means the
// self-init block never runs on the client. It mirrors the server (which resolves
// the locale via the paraglide AsyncLocalStorage scope with no side effect) and
// is forward-safe: while the framework is dormant there is no PARAGLIDE_LOCALE
// cookie so this resolves to baseLocale ('en'); once a later rollout sets the
// cookie it is read here automatically. The root loader keeps resolving the
// locale for <html lang> server-side; this only governs client render.
overwriteGetLocale(() => extractLocaleFromCookie() ?? baseLocale);

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter />
    </StrictMode>,
  );
});
