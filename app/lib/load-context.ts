import type { AppLoadContext } from "react-router";
import type { WorkerEnv } from "../../workers/env";

/**
 * The single place the app reads the Cloudflare environment out of the React
 * Router load context.
 *
 * Every loader and action goes through here rather than reaching into
 * `context.cloudflare.env` itself, so the shape of the load context is
 * changeable in one edit. That matters imminently: React Router v8 replaces the
 * plain load-context object with a `RouterContextProvider` addressed by
 * `context.get(key)`, which would otherwise be a change at every call site.
 *
 * Returns an empty env rather than throwing when the context carries none. Unit
 * tests construct bare `{}` contexts on purpose — a loader that reads an
 * optional var should be exercisable without standing up a worker — and the
 * pre-existing call sites already coped with this via `?? {}`. Anything
 * genuinely required must fail on its own absence, not on the container's.
 */
export function getCloudflareEnv(context: AppLoadContext): WorkerEnv {
  return (context?.cloudflare?.env ?? {}) as WorkerEnv;
}
