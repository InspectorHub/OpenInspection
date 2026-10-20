/**
 * Late-bound handle on the in-process API app.
 *
 * `lib/` and `services/` code sometimes has to call the API app itself: the MCP
 * identity bridge dispatches a tool call through it, the MCP tool schemas are
 * read off its OpenAPI document, and the offline import replays queued writes
 * through it. Importing `server/index` (or anything under `server/api/`) from
 * there would make the lower layers depend on the layer above them, so the
 * worker entry registers a LOADER here and callers ask for the app through it.
 *
 * Why a loader and not the app: the API graph is deliberately not part of the
 * entry's eager import graph (see `workers/app.ts`), and on a cold isolate the
 * first authenticated MCP request can arrive before anything has evaluated it.
 * Registering a loader keeps the import lazy; the loader owns its own caching.
 *
 * This module imports nothing, so it is safe in the entry's top-level graph.
 */

/** The OpenAPI document config the document builder accepts. */
export interface InProcessOpenApiConfig {
    openapi: string;
    info: { title: string; version: string };
}

/**
 * The part of the API app that callers outside `server/api/` need. Declared with
 * method syntax so the real Hono app, whose `fetch` is typed against its own
 * bindings, is assignable to it.
 */
export interface InProcessApp {
    fetch(request: Request, env?: unknown, ctx?: ExecutionContext): Response | Promise<Response>;
    getOpenAPIDocument(config: InProcessOpenApiConfig): object;
}

export type ApiAppLoader = () => Promise<InProcessApp>;

let loader: ApiAppLoader | undefined;

/** Install the loader. A second call replaces the first. */
export function registerApiAppLoader(next: ApiAppLoader): void {
    loader = next;
}

/**
 * Resolve the API app through the registered loader. Not cached here: the loader
 * decides whether to cache, so a caller sees exactly the loader's semantics.
 * Throws when nothing was registered instead of guessing a path to the app.
 */
export async function getApiApp(): Promise<InProcessApp> {
    if (!loader) {
        throw new Error('API app loader is not registered: call registerApiAppLoader() from the worker entry before dispatching in-process.');
    }
    return loader();
}
