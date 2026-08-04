/**
 * The one place server code reads compiled Paraglide messages.
 *
 * Server-side i18n has a constraint the client does not: a notification is
 * rendered FOR a recipient, whose locale is not the request's locale, and in a
 * cron or queue context there is no request at all — `getLocale()` returns
 * `baseLocale`.
 *
 * **Every recipient-facing read through here MUST pass an explicit locale** —
 * `m.some_message({ ...inputs }, { locale })` — resolved from the recipient via
 * `recipient-locale.ts`. Paraglide's message functions fall back to `getLocale()`
 * when the option is omitted, and on this side of the app that default is not a
 * sensible one: it is a silent mistranslation in exactly the firings nobody
 * tests, because a cron sweep and a queue consumer both answer `baseLocale` no
 * matter who is reading. The one place that renders such a string today
 * (`automation/trigger.ts#titleFor`) takes the locale as a REQUIRED parameter so
 * that omitting it is a type error rather than an invisible one.
 *
 * Why the disable below, and why it does not weaken the BFF boundary: the rule
 * stops `server/` depending on `app/` because `app/` is loaders, components and
 * browser-only helpers. `app/paraglide/` is none of those — it is GENERATED
 * data, compiled from `messages/**` by a build step, and it sits under `app/`
 * only because that is where the paraglide outdir points (vite.config.ts and
 * the `i18n:compile` script). Relocating it to a genuinely shared package would
 * rewrite the import in 392 files for no behavioural gain.
 *
 * The exception is kept inline rather than in eslint.config.js on purpose: as a
 * one-line disable it covers exactly this file, so every OTHER server module
 * still fails the rule if it reaches for the catalogue directly. That makes
 * "the one place" an enforced property rather than a comment. Same shape as
 * `server/lib/jwt-keyring.ts`, the sanctioned wrapper for `hono/jwt`.
 */
// eslint-disable-next-line no-restricted-imports -- this IS the sanctioned message wrapper; app/paraglide is generated data, not app code, and every other server module must still go through here.
export { m } from '~/paraglide/messages';
