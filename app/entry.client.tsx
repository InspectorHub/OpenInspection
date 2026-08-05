import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";
import { overwriteGetLocale } from "~/paraglide/runtime";
import { resolveClientLocale } from "~/lib/i18n/client-locale";

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
// the locale via the paraglide AsyncLocalStorage scope with no side effect).
//
// The cookie is not the only input, and treating it as one caused a real bug: the
// server resolves `users.locale > tenant > cookie > Accept-Language`, so a Spanish
// browser with NO cookie gets Spanish SSR — and then the client, seeing no cookie,
// fell back to baseLocale and hydration silently repainted the page in English.
// It only showed up intermittently, because whether you see it depends on catching
// the page before or after hydration. The login page makes it reachable in
// practice: it sits outside auth-layout, which is where the cookie stamp is
// written, so there is nothing to read there on a first visit.
//
// `<html lang>` is the server's already-resolved answer, rendered into the
// document the client is hydrating. Reading it back is how the two agree without a
// second resolution path that could disagree with the first.
overwriteGetLocale(() => resolveClientLocale(document.documentElement.lang));

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter />
    </StrictMode>,
  );
});
