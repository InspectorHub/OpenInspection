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
   */
  API_WORKER?: { fetch: typeof fetch };
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
};
