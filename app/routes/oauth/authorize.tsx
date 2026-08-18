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
} from "../../../server/lib/mcp/tag-catalog";
import { m } from "~/paraglide/messages";
import { cloudflareContext, getCloudflareEnv } from "~/lib/load-context";
import { writeAuditLog } from "../../../server/lib/audit";
import { getDeploymentProfile } from "../../../server/lib/deployment-profile";
import type { WorkerEnv } from "../../../workers/env";

export function meta() {
  return [{ title: m.oauth_authorize_meta_title() }];
}

/**
 * Env the shared `WorkerEnv` omits on purpose. OAUTH_PROVIDER: wrapper-injected,
 * never a binding, sole consumer.
 */
interface AuthorizeEnv {
  OAUTH_PROVIDER?: OAuthHelpers;
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

/**
 * Login redirect preserving the in-flight authorize request. Takes the
 * normalized `url`, not `request.url`, whose `.data` suffix under
 * v8_passThroughRequests would be baked into the returnTo (bites on the action
 * path: a form POST from a client-side navigation).
 */
function loginRedirect(env: WorkerEnv & AuthorizeEnv, url: URL): Response {
  const { loginRedirectBase } = getDeploymentProfile(env);
  if (loginRedirectBase) {
    // Cross-origin bounce to the portal — send the absolute authorize URL.
    return redirect(`${loginRedirectBase}/login?returnTo=${encodeURIComponent(url.href)}`);
  }
  // Standalone: relative path back to this same authorize URL (incl. query).
  const here = `${url.pathname}${url.search}`;
  return redirect(`/login?returnTo=${encodeURIComponent(here)}`);
}

export async function loader({ request, url, context }: Route.LoaderArgs) {
  const env = getCloudflareEnv(context) as WorkerEnv & AuthorizeEnv;
  // The OAuthProvider only injects OAUTH_PROVIDER when MCP is enabled and the
  // request flowed through the provider wrapper. Absent => this endpoint is not
  // live; 404 rather than render a dead consent page.
  if (!env.OAUTH_PROVIDER) {
    throw new Response("Not Found", { status: 404 });
  }

  const token = await getToken(context, request);
  if (!token) throw loginRedirect(env, url);

  const identity = await resolveIdentity(context, token);
  if (!identity) throw loginRedirect(env, url);

  // parseAuthRequest reads the OAuth params from THIS request's query string;
  // it only works on the initial GET. We serialize the result into a hidden
  // field so the action can complete authorization without re-parsing.
  const authReq = await env.OAUTH_PROVIDER.parseAuthRequest(request);
  const client = await env.OAUTH_PROVIDER.lookupClient(authReq.clientId);
  const clientName = client?.clientName?.trim() || m.oauth_authorize_client_fallback();

  return {
    clientName,
    role: identity.role,
    modules: visibleModuleGroups(identity.role),
    canWrite: roleCanWrite(identity.role),
    oauthReqJson: JSON.stringify(authReq),
  };
}

export async function action({ request, url, context }: Route.ActionArgs) {
  const env = getCloudflareEnv(context) as WorkerEnv & AuthorizeEnv;
  if (!env.OAUTH_PROVIDER) {
    throw new Response("Not Found", { status: 404 });
  }

  const token = await getToken(context, request);
  if (!token) throw loginRedirect(env, url);

  const identity = await resolveIdentity(context, token);
  if (!identity) throw loginRedirect(env, url);

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
  const clientName = client?.clientName?.trim() || m.oauth_authorize_client_fallback();

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

  // A grant being CREATED is at least as audit-worthy as one being revoked, and
  // until now only the revocation was recorded. This is a React Router action,
  // not a Hono handler, so `auditFromContext` is unavailable; the tenant and the
  // actor are the identity this action already resolved and proved.
  //
  // `waitUntil` matters here: the response is a redirect, and without it the
  // isolate can be torn down before the insert lands.
  writeAuditLog({
    db: env.DB,
    tenantId: identity.tenantId,
    userId: identity.userId,
    action: "mcp.grant.created",
    entityType: "mcp_grant",
    metadata: { clientId: authReq.clientId },
    executionCtx: context?.get(cloudflareContext).ctx,
  });

  return redirect(redirectTo);
}

/* ------------------------------------------------------------------ */
/* Consent UI                                                          */
/* ------------------------------------------------------------------ */

// Lives in its own module (this one is at the file-size cap), and is
// re-exported here because the route is where readers and the standalone
// render spec look for it.
export { ConsentForm, type ConsentFormProps } from "~/components/oauth/ConsentForm";
// Imported as well as re-exported: `AuthorizePage` below renders it, and a
// bare `export ... from` does not bind the name locally.
import { ConsentForm } from "~/components/oauth/ConsentForm";

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
