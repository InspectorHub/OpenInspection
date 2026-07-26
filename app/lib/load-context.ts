import { createContext, RouterContextProvider } from "react-router";
import type { WorkerEnv } from "../../workers/env";

/**
 * The load context React Router hands to loaders, actions, and middleware.
 *
 * With `future.v8_middleware` this is a `RouterContextProvider` addressed by
 * typed keys, not a plain object. Aliased here so the app names one type: if it
 * changes again, this line changes, not every signature in `app/`.
 */
export type LoadContext = Readonly<RouterContextProvider>;

/**
 * What the worker entry puts on the load context.
 *
 * The default makes an unseeded context behave like an empty env instead of
 * throwing. Unit tests construct bare contexts on purpose — a loader reading an
 * optional var should be exercisable without standing up a worker — and this
 * preserves what the previous `?? {}` call sites did. Anything genuinely
 * required must fail on its own absence, not on the container's.
 */
export const cloudflareContext = createContext<{
  env: WorkerEnv;
  /**
   * Structural rather than `ExecutionContext`: the value comes from Hono's
   * `c.executionCtx`, which omits fields the workerd ambient type requires.
   * Nothing in `app/` reads it today — it is carried for `waitUntil`.
   */
  ctx: { waitUntil(promise: Promise<unknown>): void } | undefined;
}>({ env: {} as WorkerEnv, ctx: undefined });

/**
 * The single place the app reads the Cloudflare environment out of the load
 * context. Every loader and action goes through here rather than addressing the
 * context itself, which is what kept the v8 migration to one edit.
 */
export function getCloudflareEnv(context: LoadContext): WorkerEnv {
  return context?.get(cloudflareContext).env ?? ({} as WorkerEnv);
}

/**
 * Build a load context for tests.
 *
 * Exported from the module it mirrors rather than a test helper file: the
 * context is now an opaque provider rather than an object literal, so a spec
 * cannot construct one by hand without duplicating the key. Keeping the two
 * together means a change to the shape updates both at once.
 */
export function createLoadContext(env: Partial<WorkerEnv> = {}): LoadContext {
  const context = new RouterContextProvider();
  context.set(cloudflareContext, { env: env as WorkerEnv, ctx: undefined });
  return context;
}
