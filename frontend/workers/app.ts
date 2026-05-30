import { createRequestHandler } from "react-router";

declare module "react-router" {
  export interface AppLoadContext {
    cloudflare: {
      env: Env;
      ctx: ExecutionContext;
    };
  }
}

// Minimal Env shape — bindings we read from React Router loaders/actions
// flow through `context.cloudflare.env`. The full set is declared in
// frontend/wrangler.toml ([[services]] API_WORKER, [vars] API_URL +
// SESSION_SECRET, [assets] ASSETS).
interface Env {
  API_WORKER?: Fetcher;
  ASSETS?: Fetcher;
  API_URL?: string;
  SESSION_SECRET?: string;
}

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request, env, ctx) {
    return requestHandler(request, {
      cloudflare: { env, ctx },
    });
  },
} satisfies ExportedHandler<Env>;
