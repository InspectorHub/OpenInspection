// Single-worker entry (cloudflare/react-router-hono-fullstack-template shape):
// Hono is the worker entry; it mounts the full OpenInspection API and delegates
// every other path to the React Router SSR handler. Replaces the dual-worker
// (API worker + web worker + Service Binding) topology with one deployable.
import { Hono } from "hono";
import { createRequestHandler } from "react-router";
import apiHandler, { app as apiApp } from "../server/index";

declare module "react-router" {
  export interface AppLoadContext {
    cloudflare: {
      env: Env;
      ctx: ExecutionContext;
    };
  }
}

interface Env {
  ASSETS?: Fetcher;
  API_URL?: string;
  SESSION_SECRET?: string;
}

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

// React Router SSR. We inject an in-process `API_WORKER` self-binding so that
// loaders/actions' `createApi()` call the API app DIRECTLY (its createApi prefers
// env.API_WORKER.fetch) instead of an HTTP loopback to this same worker — no
// extra network hop, no API_URL needed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ssr = (c: any) => {
  const env = {
    ...c.env,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    API_WORKER: { fetch: (req: Request) => apiApp.fetch(req, c.env, c.executionCtx) },
  };
  return requestHandler(c.req.raw, { cloudflare: { env, ctx: c.executionCtx } });
};

// Delegate to the FULL API app (all its global `app.use('*')` middleware — CSRF,
// tenant routing, DI, branding, … — runs INSIDE this call). By routing only
// API-owned paths here, that middleware never blankets frontend routes, which is
// what caused the CSRF 403 on the frontend's /login POST when the API was mounted
// at "/". Mirrors the CF template's "explicit API routes before the catch-all".
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toApi = (c: any) => apiApp.fetch(c.req.raw, c.env, c.executionCtx);

const app = new Hono();

// --- API-owned paths → the API app (with its middleware). Routing audit done. ---
// Bulk API surface + genuine non-/api endpoints with no React Router page:
app.all("/api/*", toApi);
app.all("/status", toApi);
app.all("/m2m/*", toApi);
app.all("/photos/*", toApi);
app.all("/.well-known/*", toApi);
app.all("/doc", toApi); // OpenAPI JSON (the RR /ui Swagger page fetches it); /ui itself is now an RR route
app.all("/sso", toApi); // saas SSO handoff (coreAuthRoutes is also mounted at '/')
app.all("/sign/*", toApi); // public signing pages — no React Router /sign route
app.get("/inspector/:tenant/:slug/calendar.ics", toApi); // ICS feed (API-only)
app.get("/observe/:token", toApi); // 1-seg observe — RR owns /observe/inspections/:id

// Audited as React Router-owned (the RR migration superseded the API HTML; the API
// still serves their DATA under /api/public/*): /book /report /r /messages /verify
// /agreements /login /logout /forgot-password /dashboard and all dashboard pages.

// --- Everything else → React Router SSR (all pages incl. "/") ---
// Static assets (/favicon.svg, /styles.css, /vendor/*, /fonts/*) are served by the
// Cloudflare assets layer from build/client before the worker runs.
app.all("*", ssr);

// fetch from the merged Hono app; scheduled (cron) reused from the API handler.
export default {
  fetch: app.fetch,
  scheduled: apiHandler.scheduled,
};

// Re-export Durable Objects + Workflow so wrangler can bind them on the single
// worker (their class names are referenced by the combined wrangler config).
export { InspectionPresenceDO } from "../server/durable-objects/inspection-presence";
export { TenantPresenceDO } from "../server/durable-objects/tenant-presence";
export { SignCompletionWorkflow } from "../server/workflows/sign-completion-workflow";
