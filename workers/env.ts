/**
 * The environment shape reachable from React Router loaders/actions.
 *
 * This is the wrangler-generated global `Env` (every binding and var declared
 * in the active wrangler config — see worker-configuration.d.ts) EXTENDED with
 * the few fields `wrangler types` cannot know about. Extending rather than
 * re-declaring matters: a local `interface Env` in the worker entry shadows the
 * generated global for that file, and because the entry is what augments
 * `AppLoadContext`, every `context.cloudflare.env.*` read in the app would
 * silently narrow to the hand-listed subset — no error, just vanished
 * autocompletion and typos that stop being caught.
 *
 * Kept in its own module (no imports, no side effects) so the type can be
 * asserted from a type-only spec without pulling the worker entry — and its
 * `virtual:react-router/server-build` import — into that program.
 */
export type WorkerEnv = Env & {
  /**
   * In-process self-binding injected by the worker entry so RR loaders call the
   * API app directly (no network hop). Set on the load context; never declared
   * in any wrangler config, so typegen cannot emit it.
   *
   * Typed as the contract its single caller actually uses — a prepared Request
   * in, a Response out — rather than the full `typeof fetch`, whose (input,
   * init) overloads nothing here supplies.
   */
  API_WORKER?: { fetch: (request: Request) => Promise<Response> };
  /**
   * Static-assets fetcher. Declared in wrangler as an `assets` block rather
   * than a `services`/`bindings` entry, and `wrangler types` does not emit an
   * `Env` field for it — verified against the committed
   * worker-configuration.d.ts, where ASSETS appears only in the workerd runtime
   * types, never in `Cloudflare.Env`.
   */
  ASSETS?: Fetcher;
  /**
   * Signing secret for the React Router `__session` cookie. A secret, so it is
   * absent from the committed placeholder wrangler config that typegen runs
   * against; it is provisioned via `wrangler secret` / `.dev.vars`.
   */
  SESSION_SECRET?: string;
  /**
   * Base URL of the API when it is reached over HTTP instead of the in-process
   * self-binding. Lives only in the gitignored wrangler.local / wrangler.saas
   * configs, so typegen against the placeholder never sees it.
   */
  API_URL?: string;
  /**
   * `standalone` (default) or `saas`. Declared only in the gitignored SaaS
   * config, so typegen against the committed placeholder never emits it.
   */
  APP_MODE?: string;
  /**
   * The SaaS portal's base-URL var is deliberately NOT declared here. The
   * SaaS-portal isolation gate (tests/unit/sync/portal-isolation.spec.ts)
   * confines that name to a short list of integration-boundary files so portal
   * coupling cannot spread by being merely convenient to reach; declaring it on
   * the shared env would hand it to every loader, which is what the gate exists
   * to prevent. The one route that needs it declares it locally. (The name is
   * spelled out nowhere in this file for the same reason — the gate matches on
   * the literal, comments included.)
   */
  /**
   * Optional Google Maps JS key for the client-side map. A plaintext var set
   * per deployment rather than in the committed config.
   */
  GOOGLE_MAPS_JS_API_KEY?: string;
  /**
   * QuickBooks OAuth credentials. Secrets, so — like SESSION_SECRET — they are
   * absent from the placeholder config typegen runs against.
   *
   * The settings loader reads these to say WHETHER the deployment supplies a
   * credential, never to send one to the browser. Presence is the whole
   * answer: the same three names can instead be stored per tenant, and a form
   * that can only see the stored copy calls a centrally-configured deployment
   * "not configured".
   */
  QBO_CLIENT_ID?: string;
  QBO_CLIENT_SECRET?: string;
  QBO_WEBHOOK_SECRET?: string;
  /**
   * Which Intuit host to talk to. Not a credential and not a secret, but it
   * shares their fate: it is set per deployment rather than in the committed
   * placeholder config, so typegen never sees it either. The settings loader
   * reads it for the same reason as the three above — to say whether the
   * deployment already supplies one.
   */
  QBO_ENV?: string;
};
