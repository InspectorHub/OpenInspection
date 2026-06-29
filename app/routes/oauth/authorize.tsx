import { useState } from "react";
import { redirect, useLoaderData, useNavigation } from "react-router";
import type { AuthRequest, ClientInfo, OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import type { Route } from "./+types/authorize";
import { getToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { isRole, type Role } from "../../../server/lib/auth/roles";
import type { McpProps } from "../../../server/durable-objects/inspector-mcp";
import {
  computeGrantedScopes,
} from "../../../server/lib/mcp/scopes";
import {
  visibleModuleGroups,
  roleCanWrite,
  selectedScopesFromForm,
  type ModuleGroup,
} from "../../../server/lib/mcp/tag-catalog";

export function meta() {
  return [{ title: "Authorize access - OpenInspection" }];
}

/**
 * Env subset this route reads. `context.cloudflare.env` is typed by the minimal
 * worker-entry `Env` interface (workers/app.ts) that omits plaintext vars and
 * the OAuthProvider-injected helper, so — like login.tsx with APP_MODE /
 * PORTAL_API_URL — we cast to the shape we actually consume. OAUTH_PROVIDER is
 * injected by the OAuthProvider wrapper for requests that reach the
 * defaultHandler (it flows into context.cloudflare.env via the SSR handler).
 */
interface AuthorizeEnv {
  OAUTH_PROVIDER?: OAuthHelpers;
  APP_MODE?: string;
  PORTAL_API_URL?: string;
}

/** Resolved end-user identity backing an OAuth grant. */
interface McpIdentity {
  userId: string;
  tenantId: string;
  tenantSlug: string;
  role: Role;
}

/**
 * Decode the unverified claims of an already-trusted JWT (our own HttpOnly
 * session cookie). Used only to read `sub` and `custom:tenantId`; the token's
 * validity is proven separately by a successful session-context API call (the
 * API verifies the bearer), so this decode never stands alone as an authz gate.
 */
function decodeJwtClaims(token: string): { sub?: string; tenantId?: string } {
  try {
    const part = token.split(".")[1];
    if (!part) return {};
    let b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    b64 += "=".repeat((4 - (b64.length % 4)) % 4);
    const payload = JSON.parse(atob(b64)) as Record<string, unknown>;
    const tenantId = (payload["custom:tenantId"] ?? payload["tenantId"]) as string | undefined;
    return { sub: typeof payload.sub === "string" ? payload.sub : undefined, tenantId };
  } catch {
    return {};
  }
}

/**
 * Resolve the current user's authoritative identity for the grant props.
 * Role + tenantSlug come from the verified session-context API; userId +
 * tenantId from the (now-proven-valid) JWT. Returns null when the session is
 * missing/invalid or the role is unrecognized (fail closed).
 */
async function resolveIdentity(
  context: Route.LoaderArgs["context"],
  token: string,
): Promise<McpIdentity | null> {
  let role: string | undefined;
  let tenantSlug = "";
  try {
    const api = createApi(context, { token });
    const res = await api.sessionContext.context.$get();
    if (!res.ok) return null;
    const body = (await res.json()) as {
      data?: { user?: { role?: string }; branding?: { tenantSlug?: string | null } };
    };
    role = body.data?.user?.role;
    tenantSlug = body.data?.branding?.tenantSlug ?? "";
  } catch {
    return null;
  }
  if (!role || !isRole(role)) return null;
  const { sub, tenantId } = decodeJwtClaims(token);
  if (!sub || !tenantId) return null;
  return { userId: sub, tenantId, tenantSlug, role };
}

/**
 * True only when `redirectUri` is one of the client's REGISTERED redirect URIs.
 * The cancel path bounces to `redirectUri`, which is deserialized from the
 * user-submitted `oauthReq` hidden field — an attacker could tamper it into an
 * open redirect. The Authorize path is safe because `completeAuthorization`
 * validates the redirect URI internally; the cancel path must validate it here.
 */
export function isRegisteredRedirectUri(
  client: ClientInfo | null | undefined,
  redirectUri: string,
): boolean {
  return (
    !!client &&
    Array.isArray(client.redirectUris) &&
    client.redirectUris.includes(redirectUri)
  );
}

/** Build the login redirect that preserves the in-flight authorize request. */
function loginRedirect(env: AuthorizeEnv, request: Request): Response {
  const url = new URL(request.url);
  if (env.APP_MODE === "saas" && env.PORTAL_API_URL) {
    // Cross-origin bounce to the portal — send the absolute authorize URL.
    const base = env.PORTAL_API_URL.replace(/\/$/, "");
    return redirect(`${base}/login?returnTo=${encodeURIComponent(request.url)}`);
  }
  // Standalone: relative path back to this same authorize URL (incl. query).
  const here = `${url.pathname}${url.search}`;
  return redirect(`/login?returnTo=${encodeURIComponent(here)}`);
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env as unknown as AuthorizeEnv;
  // The OAuthProvider only injects OAUTH_PROVIDER when MCP is enabled and the
  // request flowed through the provider wrapper. Absent => this endpoint is not
  // live; 404 rather than render a dead consent page.
  if (!env.OAUTH_PROVIDER) {
    throw new Response("Not Found", { status: 404 });
  }

  const token = await getToken(context, request);
  if (!token) throw loginRedirect(env, request);

  const identity = await resolveIdentity(context, token);
  if (!identity) throw loginRedirect(env, request);

  // parseAuthRequest reads the OAuth params from THIS request's query string;
  // it only works on the initial GET. We serialize the result into a hidden
  // field so the action can complete authorization without re-parsing.
  const authReq = await env.OAUTH_PROVIDER.parseAuthRequest(request);
  const client = await env.OAUTH_PROVIDER.lookupClient(authReq.clientId);
  const clientName = client?.clientName?.trim() || "An application";

  return {
    clientName,
    role: identity.role,
    modules: visibleModuleGroups(identity.role),
    canWrite: roleCanWrite(identity.role),
    oauthReqJson: JSON.stringify(authReq),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env as unknown as AuthorizeEnv;
  if (!env.OAUTH_PROVIDER) {
    throw new Response("Not Found", { status: 404 });
  }

  const token = await getToken(context, request);
  if (!token) throw loginRedirect(env, request);

  const identity = await resolveIdentity(context, token);
  if (!identity) throw loginRedirect(env, request);

  const formData = await request.formData();
  let authReq: AuthRequest;
  try {
    authReq = JSON.parse(String(formData.get("oauthReq"))) as AuthRequest;
  } catch {
    throw new Response("Bad Request", { status: 400 });
  }

  // The clientName/redirectUri both derive from the (untrusted) hidden field, so
  // resolve the REGISTERED client once and validate against it.
  const client = await env.OAUTH_PROVIDER.lookupClient(authReq.clientId);
  const clientName = client?.clientName?.trim() || "An application";

  // Cancel => bounce back to the client's redirect_uri with an OAuth error
  // (RFC 6749 §4.1.2.1) — but ONLY if that redirect_uri is registered to the
  // client. A tampered/unregistered URI would be an open redirect; fall back to
  // a safe in-app destination instead of redirecting off to it.
  if (formData.get("cancel") != null) {
    if (!isRegisteredRedirectUri(client, authReq.redirectUri)) {
      return redirect("/inspections");
    }
    const u = new URL(authReq.redirectUri);
    u.searchParams.set("error", "access_denied");
    if (authReq.state) u.searchParams.set("state", authReq.state);
    return redirect(u.toString());
  }

  const visible = visibleModuleGroups(identity.role);
  const selected = selectedScopesFromForm(formData, visible);
  const granted = computeGrantedScopes({
    requested: authReq.scope ?? [],
    selected,
    role: identity.role,
  });

  const props: McpProps = {
    userId: identity.userId,
    tenantId: identity.tenantId,
    tenantSlug: identity.tenantSlug,
    role: identity.role,
    scopes: granted,
  };

  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: authReq,
    userId: identity.userId,
    scope: granted,
    metadata: { clientName },
    props,
  });

  return redirect(redirectTo);
}

/* ------------------------------------------------------------------ */
/* Consent UI                                                          */
/* ------------------------------------------------------------------ */

export interface ConsentFormProps {
  clientName: string;
  role: string;
  modules: ModuleGroup[];
  canWrite: boolean;
  oauthReqJson: string;
  submitting?: boolean;
}

/**
 * The modules x Read/Write consent grid. A native <form method="post"> (no
 * react-router <Form>) so the page works without JS and renders standalone in
 * unit tests. Checkboxes are controlled; ticking Write auto-ticks Read.
 */
export function ConsentForm({
  clientName,
  modules,
  canWrite,
  oauthReqJson,
  submitting = false,
}: ConsentFormProps) {
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const setRead = (key: string, v: boolean) =>
    setChecked((c) => {
      const next = { ...c, [`read:${key}`]: v };
      // Unticking Read also unticks Write (write implies read).
      if (!v) next[`write:${key}`] = false;
      return next;
    });
  const setWrite = (key: string, v: boolean) =>
    setChecked((c) => ({
      ...c,
      [`write:${key}`]: v,
      // Ticking Write implies Read.
      ...(v ? { [`read:${key}`]: true } : {}),
    }));

  const selectAllRead = () =>
    setChecked((c) => {
      const next = { ...c };
      for (const g of modules) next[`read:${g.key}`] = true;
      return next;
    });
  const clearAll = () => setChecked({});

  return (
    <div className="min-h-screen flex items-center justify-center bg-ih-bg-app px-4">
      <div className="w-full max-w-lg p-8">
        <div className="flex items-center gap-3 mb-6">
          <img src="/logo.svg" alt="" className="w-8 h-8" width={32} height={32} />
          <span className="text-lg font-bold text-ih-fg-1">OpenInspection</span>
        </div>

        <h1 className="text-2xl font-bold text-ih-fg-1 mb-2">
          Authorize access
        </h1>
        <p className="text-sm text-ih-fg-3 mb-6">
          <span className="font-semibold text-ih-fg-1">{clientName}</span> wants to
          access your OpenInspection data. Choose what it can read and change, then
          authorize.
        </p>

        <form method="post" className="space-y-5">
          <input type="hidden" name="oauthReq" value={oauthReqJson} />

          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wide text-ih-fg-3">
              Modules
            </span>
            <div className="flex items-center gap-3 text-xs">
              <button
                type="button"
                onClick={selectAllRead}
                className="font-semibold text-ih-primary hover:underline"
              >
                Select all read
              </button>
              <button
                type="button"
                onClick={clearAll}
                className="font-semibold text-ih-fg-3 hover:underline"
              >
                None
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-ih-border bg-ih-bg-card divide-y divide-ih-border">
            <div className="grid grid-cols-[1fr_auto_auto] gap-x-6 px-4 py-2 text-xs font-bold uppercase tracking-wide text-ih-fg-3">
              <span>Module</span>
              <span className="text-center w-12">Read</span>
              {canWrite && <span className="text-center w-12">Write</span>}
            </div>
            {modules.map((g) => (
              <div
                key={g.key}
                data-testid={`module-${g.key}`}
                className="grid grid-cols-[1fr_auto_auto] gap-x-6 items-center px-4 py-3"
              >
                <span className="text-sm font-medium text-ih-fg-1">{g.label}</span>
                <label className="flex justify-center w-12 cursor-pointer">
                  <input
                    type="checkbox"
                    name={`read:${g.key}`}
                    value="1"
                    checked={!!checked[`read:${g.key}`]}
                    onChange={(e) => setRead(g.key, e.target.checked)}
                    className="h-4 w-4 rounded border-ih-border text-ih-primary focus:ring-ih-primary"
                    aria-label={`Read ${g.label}`}
                  />
                </label>
                {canWrite && (
                  <label className="flex justify-center w-12 cursor-pointer">
                    <input
                      type="checkbox"
                      name={`write:${g.key}`}
                      value="1"
                      checked={!!checked[`write:${g.key}`]}
                      onChange={(e) => setWrite(g.key, e.target.checked)}
                      className="h-4 w-4 rounded border-ih-border text-ih-primary focus:ring-ih-primary"
                      aria-label={`Write ${g.label}`}
                    />
                  </label>
                )}
              </div>
            ))}
          </div>

          <p className="text-xs text-ih-fg-3">
            Ticking Write also grants Read. Access is limited to your role and to
            what {clientName} requested.
          </p>

          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              name="cancel"
              value="1"
              className="flex-1 py-2.5 rounded-lg border border-ih-border bg-ih-bg-card text-ih-fg-1 font-bold text-sm hover:bg-ih-bg-app transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              data-testid="oauth-authorize-submit"
              disabled={submitting}
              className="flex-1 py-2.5 rounded-lg bg-ih-primary text-white font-bold text-sm hover:bg-ih-primary-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {submitting ? "Authorizing…" : "Authorize"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function AuthorizePage() {
  const data = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  return (
    <ConsentForm
      clientName={data.clientName}
      role={data.role}
      modules={data.modules}
      canWrite={data.canWrite}
      oauthReqJson={data.oauthReqJson}
      submitting={navigation.state === "submitting"}
    />
  );
}
