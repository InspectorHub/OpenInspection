/**
 * The one place server code reads compiled Paraglide messages.
 *
 * Server-side i18n has a constraint the client does not: a notification is
 * rendered FOR a recipient, whose locale is not the request's locale, and in a
 * cron or queue context there is no request at all — `getLocale()` returns
 * `baseLocale`. Recipient-locale resolution is a separate piece of work. Until
 * it lands, every message read through here resolves in the ambient locale,
 * which for notifications means English. Routing this through one module means
 * that change touches one file rather than every call site.
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
