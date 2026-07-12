/**
 * Commercial PCA — BFF resource route that relays the authenticated cost-export
 * download (CSV / XLSX) to the browser.
 *
 * Why a relay instead of a plain `<a href="/api/inspections/:id/cost-export.csv">`:
 * over local `http://localhost` Chromium DROPS the `__Host-inspector_token`
 * Secure cookie, so a direct browser GET to the `/api/*` route 401s in dev even
 * though it authenticates fine in production HTTPS. Routing the download through
 * this RR resource route — which the browser reaches with the plain `__session`
 * cookie — lets the server relay the JWT via `createApi(..., { token })`, so the
 * button works identically in local http dev and prod. Mirrors `cost-items.tsx`'s
 * relay; the only twist is the body is BINARY (xlsx), so we stream the upstream
 * `Response` through untouched, preserving status + Content-Type +
 * Content-Disposition rather than `.json()`/`.text()`-ing it.
 *
 * loader: GET ?inspectionId=&format=csv|xlsx -> the raw upstream file Response.
 * The upstream route is role-gated (owner/manager/inspector) + tenant-scoped by
 * JWT (never client input), so an unauthenticated or wrong-tenant caller gets the
 * upstream 401/403 relayed verbatim.
 */
import type { Route } from "./+types/cost-export";
import { getToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";

const RELAY = { headers: { "x-token-relay": "1" } } as const;

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await getToken(context, request);
  if (!token) return new Response("Unauthorized", { status: 401 });

  const url = new URL(request.url);
  const inspectionId = url.searchParams.get("inspectionId") ?? "";
  const format = url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  if (!inspectionId) return new Response("Missing inspectionId", { status: 400 });

  const api = createApi(context, { token });
  const upstream =
    format === "xlsx"
      ? await api.inspections[":id"]["cost-export.xlsx"].$get({ param: { id: inspectionId } }, RELAY)
      : await api.inspections[":id"]["cost-export.csv"].$get({ param: { id: inspectionId } }, RELAY);

  // Stream the upstream file through untouched: preserve status, Content-Type,
  // and Content-Disposition (the server stamps `cost-items-<id>.csv/.xlsx` as an
  // `attachment`), and pass the binary body verbatim (never decode an xlsx). Any
  // non-2xx (401/403/404) is relayed with its own status + body, so the caller
  // sees the real upstream failure rather than a masked one.
  const headers = new Headers();
  const ct = upstream.headers.get("Content-Type");
  const cd = upstream.headers.get("Content-Disposition");
  if (ct) headers.set("Content-Type", ct);
  if (cd) headers.set("Content-Disposition", cd);
  return new Response(upstream.body, { status: upstream.status, headers });
}
