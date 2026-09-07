// Single-worker entry (cloudflare/react-router-hono-fullstack-template shape):
// Hono is the worker entry; it mounts the full OpenInspection API and delegates
// every other path to the React Router SSR handler. Replaces the dual-worker
// (API worker + web worker + Service Binding) topology with one deployable.
import { Hono, type Context } from "hono";
import { createRequestHandler, RouterContextProvider } from "react-router";
import { buildOAuthHandler } from "../server/lib/mcp/oauth-provider";
// Safe at the top level despite this entry's tiny-import-graph rule:
// `deployment-profile.ts` imports nothing at all — it is two constants and a
// resolver over `ProfileEnv`. Pulling it in does not drag the API graph in
// behind it, which is the thing that rule protects.
import { getDeploymentProfile } from "../server/lib/deployment-profile";
// Same top-level exemption as `deployment-profile.ts` above, for the same
// reason: `request-scope.ts` imports nothing at all, so it cannot drag the API
// graph in behind it.
import { createRequestScope, REQUEST_SCOPE } from "../server/lib/request-scope";
// Five string constants, no imports — safe at the top level for the same reason
// as the two above, and what lets /status answer without importing the API graph.
import { BUILD } from "../server/generated/version";
// i18n Phase C — request-scoped locale. paraglideMiddleware establishes an
// AsyncLocalStorage scope so getLocale()/m.*() resolve per-request (never a
// module-global) across the multi-tenant Worker. Generated (git-ignored); the
// paraglide vite plugin + the prebuild `i18n:compile` step keep it present.
import { paraglideMiddleware } from "../app/paraglide/server.js";
// i18n activation (#269) — the request-borne half of locale resolution. Runs
// BEFORE paraglideMiddleware because paraglide reads the locale off the
// INCOMING request: a locale decided later cannot change the render that is
// already under way. See the seam note in ui-locale.ts.
import { withResolvedUiLocale } from "../server/lib/i18n/ui-locale";
import type { WorkerEnv } from "./env";
import { cloudflareContext } from "../app/lib/load-context";

/** Hono context for this worker, so handlers need no `any`. */
type Ctx = Context<{ Bindings: WorkerEnv }>;

// The load context is a RouterContextProvider seeded per request in `ssr()`
// below; `cloudflareContext` is its only key. No `AppLoadContext` module
// augmentation any more — that interface is unused once middleware is on.

// The API graph (server/index → every route/service/dep) is imported LAZILY.
// Evaluating it at module top-level breaks `react-router dev`: the
// @cloudflare/vite-plugin dev runner evaluates the worker entry under Vite's
// SSR transform to detect export types, and a transitive CJS dep in the API
// graph crashes that evaluation (the build + real-workerd path is unaffected).
// Deferring the import keeps the entry's top-level graph tiny, so dev-mode
// export-type detection succeeds; the first real request pays a one-time
// (cached) import. See docs/develop/architecture.md for the dev-mode notes.
type ApiModule = typeof import("../server/index");
let apiModule: Promise<ApiModule> | undefined;
const getApi = () => (apiModule ??= import("../server/index"));

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

// React Router SSR. We inject an in-process `API_WORKER` self-binding so that
// loaders/actions' `createApi()` call the API app DIRECTLY (its createApi prefers
// env.API_WORKER.fetch) instead of an HTTP loopback to this same worker — no
// extra network hop, no API_URL needed.
const ssr = (c: Ctx) => {
  // One scope per OUTER request, shared by every in-process API call this
  // render fans out. Built once here rather than per call: the 15 calls must
  // see the SAME scope or nothing is shared. `toApi` — the entry for real
  // external HTTP traffic — keeps passing the raw `c.env`, so memoisation is
  // unreachable from outside by construction rather than by a flag.
  const scope = createRequestScope();
  const innerEnv = { ...c.env, [REQUEST_SCOPE]: scope };
  const env: WorkerEnv = {
    ...c.env,
    API_WORKER: {
      fetch: async (req: Request) =>
        (await getApi()).app.fetch(req, innerEnv, c.executionCtx),
    },
  };
  const context = new RouterContextProvider();
  context.set(cloudflareContext, { env, ctx: c.executionCtx });
  // Run the whole RR pipeline (loaders → actions → render) INSIDE the paraglide
  // ALS scope, so getLocale()/m.*() resolve to this request's locale in server
  // loaders/actions AND during SSR. cookie strategy ⇒ no URL rewrite/redirect,
  // so the callback's request is the original.
  //
  // This stays wrapped AROUND requestHandler rather than becoming a route
  // middleware: it has to cover loaders, actions, AND the render pass, and only
  // the outer position does. Moving it inside would narrow the scope silently —
  // locale would fall back to baseLocale with nothing raising an error.
  //
  // withResolvedUiLocale stamps the resolved locale into the Cookie header the
  // middleware is about to read, so a first visit renders in the visitor's
  // language instead of English-then-Spanish. It returns the SAME request
  // object once the cookie already agrees, which is every request after the
  // first — the steady-state cost here is one header read.
  return paraglideMiddleware(withResolvedUiLocale(c.req.raw), ({ request }) =>
    requestHandler(request, context),
  );
};

// Delegate to the FULL API app (all its global `app.use('*')` middleware — CSRF,
// tenant routing, DI, branding, … — runs INSIDE this call). By routing only
// API-owned paths here, that middleware never blankets frontend routes, which is
// what caused the CSRF 403 on the frontend's /login POST when the API was mounted
// at "/". Mirrors the CF template's "explicit API routes before the catch-all".
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toApi = async (c: any) =>
  (await getApi()).app.fetch(c.req.raw, c.env, c.executionCtx);

const app = new Hono();

// --- API-owned paths → the API app (with its middleware). Routing audit done. ---
// Bulk API surface + genuine non-/api endpoints with no React Router page:
// SaaS-Portal M2M integration: mounted only where the surface exists. Where it
// does not, the prefix 404s — there is no platform on the other end, and a
// surface that answers is a surface somebody probes. See server/portal/.
//
// This runs before any middleware, so `c.var.profile` is not available — but
// `getDeploymentProfile` takes `ProfileEnv`, not `AppEnv`, and that widening
// exists for exactly this class of caller. It was reading `APP_MODE` under an
// allowlist entry whose stated reason ("runs before middleware") was true of
// the context and not of the function.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.all("/api/platform/*", (c: any) =>
    getDeploymentProfile(c.env).hasPortalIntegrationApi ? toApi(c) : c.notFound(),
);
app.all("/api/*", toApi);
// Served HERE, not through `toApi`, and that is the whole point: `toApi` calls
// `getApi()`, which lazily imports the entire API module graph. A health check
// that answers with a build stamp was paying for that import — measured in
// production over 24h, `GET /status` averaged 46.8ms of CPU with a max of 108ms,
// which is module evaluation on a cold isolate, not request work.
//
// It is polled by uptime monitoring and by the superproject's
// check-deploy-lag.mjs, so it is exactly the request most likely to ARRIVE at a
// cold isolate and warm the whole API for nothing.
//
// `generated/version.ts` is a tiny standalone module — five string constants and
// no imports — so this keeps the entry's top-level graph small, the same
// exemption `deployment-profile.ts` and `request-scope.ts` already carry.
//
// ⚠️ The response shape is load-bearing: check-deploy-lag.mjs reads `commit` and
// `branch`, and refuses to report "no lag" for a status it cannot parse. Keep it
// byte-compatible with the `/status` route in server/index.ts, which stays for
// the standalone and in-process test paths that call the API app directly.
app.get("/status", (c) =>
  c.json({
    status: "ok",
    app: "openinspection-core",
    version: BUILD.version,
    commit: BUILD.shortCommit,
    branch: BUILD.branch,
    buildTime: BUILD.buildTime,
    timestamp: new Date().toISOString(),
  }),
);
// Non-GET verbs keep the old path: they are not health checks and have no
// reason to bypass the API.
app.all("/status", toApi);
app.all("/m2m/*", toApi);
app.all("/webhooks/*", toApi); // inbound provider webhooks — top-level by design (spec §3)
app.all("/photos/*", toApi);
app.all("/.well-known/*", toApi);
app.all("/doc", toApi); // OpenAPI JSON (the RR /ui Swagger page fetches it); /ui itself is now an RR route
app.all("/sso", toApi); // saas SSO handoff — the one auth route mounted at '/' (ssoRootRoutes)
app.all("/sign/*", toApi); // public signing pages — no React Router /sign route
app.all("/agent/magic-login", toApi); // agent unified link redeem — no React Router page for this path
app.get("/inspector/:tenant/:slug/calendar.ics", toApi); // ICS feed (API-only)
// Removed: `/observe/:token`. It forwarded to the API app, which has never had
// a route there, and the React Router route its comment claimed ("RR owns
// /observe/inspections/:id") does not exist either — the observe surface is
// `/api/portal/{tenant}/inspections/{id}/observe`. It has been dead on both
// sides since the single-worker migration; the entry-dispatch parity gate is
// what finally said so.

// NOT listed here on purpose: `/mcp` and `/mcp/{slug}`. That prefix is owned by
// the OAuthProvider wrapper installed around this whole app in `fetch` below —
// it matches `apiRoute` as a literal path prefix and hands the request to the
// McpAgent Durable Object, so it never reaches this router when MCP is enabled.
// Routing it to `toApi` would be a lie about ownership AND a behaviour change
// when the flag is off, where the path correctly falls through to the SSR 404.

// Audited as React Router-owned (the RR migration superseded the API HTML; the API
// still serves their DATA under /api/public/*): /book /report /r /messages /verify
// /agreements /login /logout /forgot-password /inspections and all app pages.

/**
 * Vulnerability-scanner probes, answered without rendering anything.
 *
 * These paths reach the catch-all below, and the catch-all is a full React
 * Router SSR render — the 404 page is a real page, with the root layout, the
 * i18n scope and the whole render pipeline behind it. Measured in production
 * over 15h: `GET /.env` cost 200ms of CPU, `/config/.env` 89ms, `/backend/.env`
 * 87ms, `/wordpress/` 172ms. One scanner walking a wordlist, each miss costing
 * roughly what a real page costs, on a worker whose CPU ceiling is 10ms per
 * invocation.
 *
 * ⚠️ EVERY PATTERN HERE MUST BE ONE NO APP ROUTE COULD EVER USE. A false
 * positive is a real page turned into a 404 with nothing to explain it, which is
 * far worse than the CPU this saves. So: no bare-word matching, no guessing at
 * "suspicious" — only file types this app never serves and tool paths that
 * belong to other stacks entirely. React Router owns everything else, including
 * genuine typos, which still get the real 404 page.
 *
 * ⚠️ This still costs a Worker INVOCATION — it is a cheap 404, not a free one.
 * The only free answer is a WAF / firewall rule at the edge, where the request
 * never reaches the worker at all. That is dashboard configuration rather than
 * code; this is the half that lives in the repo.
 */
const SCANNER_PROBE =
  /(?:^|\/)\.(?:env|git|svn|hg|aws|ssh)(?:$|[./])|(?:^|\/)(?:wp-admin|wp-login|wp-content|wp-includes|wordpress|phpmyadmin|cgi-bin|vendor\/phpunit)(?:$|\/)|\.(?:php[3457]?|asp|aspx|jsp|cgi|sql|bak|old|swp)$/i;

app.all("*", (c, next) => {
  if (!SCANNER_PROBE.test(new URL(c.req.url).pathname)) return next();
  // Plain text, no body worth parsing, and `noindex` so a crawler that stumbles
  // onto one does not keep asking.
  return c.text("Not Found", 404, {
    "cache-control": "public, max-age=3600",
    "x-robots-tag": "noindex",
  });
});

// --- Everything else → React Router SSR (all pages incl. "/") ---
// Static assets (/favicon.svg, /styles.css, /vendor/*, /fonts/*) are served by the
// Cloudflare assets layer from build/client before the worker runs.
app.all("*", ssr);

// fetch from the merged Hono app; scheduled (cron) + queue (sync DLQ consumer)
// reused from the API handler. The queue handler is defined in server/index.ts
// (the allowed portal-import composition point) so this entry never imports
// server/portal/* statically — it just forwards the runtime invocation.
//
// buildOAuthHandler wraps app.fetch with an OAuthProvider when MCP_ENABLED is
// set, mounting the OAuth token endpoints and Bearer-protecting the MCP API
// route. When the flag is off the call is a no-op pass-through.
export default {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fetch: (req: Request, env: any, ctx: ExecutionContext) =>
    buildOAuthHandler(app.fetch as never, env).fetch(req, env, ctx),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scheduled: async (controller: any, env: any, ctx: any) =>
    (await getApi()).default.scheduled(controller, env, ctx),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  queue: async (batch: any, env: any, ctx: any) =>
    (await getApi()).default.queue(batch, env, ctx),
};

// Re-export Durable Objects + Workflow so wrangler can bind them on the single
// worker (their class names are referenced by the combined wrangler config).
// These MUST stay static (wrangler binds the classes at module scope); their
// import graphs must stay light — see the lazy-API note above.
export { InspectionPresenceDO } from "../server/durable-objects/inspection-presence";
export { TenantPresenceDO } from "../server/durable-objects/tenant-presence";
export { InspectionDocDO } from "../server/durable-objects/inspection-doc";
export { InspectorMcp } from "../server/durable-objects/inspector-mcp";
export { SignCompletionWorkflow } from "../server/workflows/sign-completion-workflow";
