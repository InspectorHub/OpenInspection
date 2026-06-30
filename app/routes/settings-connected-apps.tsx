import { useEffect, useState } from "react";
import { Link, useLoaderData, useFetcher } from "react-router";
import type { Route } from "./+types/settings-connected-apps";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { ConfirmDialog } from "~/components/ConfirmDialog";
import { isAdminRole } from "~/lib/access";
import type { McpGrant } from "../../server/lib/validations/mcp.schema";
import { MODULE_GROUPS } from "../../server/lib/mcp/tag-catalog";

export function meta() {
  return [{ title: "Connected applications - Settings - OpenInspection" }];
}

// ─── Loader ──────────────────────────────────────────────────────────────────

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  const api = createApi(context, { token });

  // Resolve session role to gate the admin-wide fetch, and mcpEnabled to short-circuit
  // when the feature flag is off.
  let role = "inspector";
  let isSaas = false;
  let mcpEnabledFlag = true; // fail-open: if the call throws, proceed normally
  try {
    const ctxRes = await api.sessionContext.context.$get();
    if (ctxRes.ok) {
      const body = (await ctxRes.json()) as {
        data?: {
          user?: { role?: string };
          branding?: { isSaas?: boolean };
          deployment?: { mcpEnabled?: boolean };
        };
      };
      role = body.data?.user?.role ?? "inspector";
      isSaas = body.data?.branding?.isSaas ?? false;
      mcpEnabledFlag = body.data?.deployment?.mcpEnabled ?? true;
    }
  } catch {
    // fall through with defaults — fail open on role so we still show self grants
  }

  if (!mcpEnabledFlag) {
    return { mcpEnabled: false, self: [], all: null, role, isSaas };
  }

  // Fetch own grants.
  let self: McpGrant[] = [];
  try {
    const res = await api.mcpGrants.grants.$get();
    if (res.ok) {
      const body = (await res.json()) as { data?: McpGrant[] };
      self = body.data ?? [];
    }
    // 404 = MCP not enabled; treat as empty (handled by falling through)
  } catch {
    self = [];
  }

  // Admin-only: fetch all tenant grants.
  let all: McpGrant[] | null = null;
  if (isAdminRole(role)) {
    try {
      const res = await api.mcpGrants.grants.all.$get();
      if (res.ok) {
        const body = (await res.json()) as { data?: McpGrant[] };
        all = body.data ?? [];
      } else {
        all = [];
      }
    } catch {
      all = [];
    }
  }

  return { mcpEnabled: true, self, all, role, isSaas };
}

// ─── Action ──────────────────────────────────────────────────────────────────

export async function action({ request, context }: Route.ActionArgs) {
  const token = await requireToken(context, request);
  const api = createApi(context, { token });
  const form = await request.formData();
  const intent = String(form.get("intent"));
  const id = String(form.get("id") ?? "");
  try {
    if (intent === "revoke") {
      const res = await api.mcpGrants.grants[":id"].$delete({
        param: { id },
        query: {},
      });
      return { ok: res.ok, intent, id };
    }
    if (intent === "revoke-admin") {
      const res = await api.mcpGrants.grants[":id"].$delete({
        param: { id },
        query: { admin: "1" },
      });
      return { ok: res.ok, intent, id };
    }
  } catch {
    return { ok: false, intent, id };
  }
  return { ok: false, intent, id };
}

// ─── Scope display helper ─────────────────────────────────────────────────────

/**
 * Converts a flat list of `kind:tag` scope strings into a human-readable
 * summary showing which module groups are covered with R / R+W badges.
 * Wildcards (`read:*` / `write:*`) collapse to "All modules".
 */
function ScopesSummary({ scopes }: { scopes: string[] }) {
  const hasWriteAll = scopes.includes("write:*");
  const hasReadAll = scopes.includes("read:*") || hasWriteAll;

  if (hasReadAll) {
    return (
      <span className="text-[12px] text-ih-fg-3">
        All modules{hasWriteAll ? <> — <Badge kind="W" /></> : <> — <Badge kind="R" /></>}
      </span>
    );
  }

  const covered = MODULE_GROUPS.filter((g) =>
    g.tags.some((tag) => scopes.some((s) => s.endsWith(`:${tag}`))),
  );

  if (covered.length === 0) {
    return <span className="text-[12px] text-ih-fg-4">No modules</span>;
  }

  return (
    <span className="flex flex-wrap gap-1 items-center">
      {covered.map((g) => {
        const canWrite = g.tags.some((tag) => scopes.includes(`write:${tag}`));
        return (
          <span key={g.key} className="inline-flex items-center gap-0.5 text-[11px]">
            <span className="text-ih-fg-2 font-medium">{g.label}</span>
            <Badge kind={canWrite ? "W" : "R"} />
          </span>
        );
      })}
    </span>
  );
}

function Badge({ kind }: { kind: "R" | "W" }) {
  return (
    <span
      className={
        kind === "W"
          ? "px-1 rounded text-[10px] font-bold bg-ih-bg-muted text-ih-primary"
          : "px-1 rounded text-[10px] font-bold bg-ih-bg-muted text-ih-fg-3"
      }
    >
      {kind}
    </span>
  );
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function formatUnixDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// ─── Grant row ────────────────────────────────────────────────────────────────
// One row for both lists; `showUser` adds the owner line for the admin view.

function GrantRow({
  grant,
  showUser = false,
  onRequestRevoke,
}: {
  grant: McpGrant;
  showUser?: boolean;
  onRequestRevoke: () => void;
}) {
  return (
    <div className="flex items-start gap-4 px-4 py-3">
      <div className="flex-1 min-w-0">
        <p className="font-bold text-[13px] text-ih-fg-1 truncate">
          {grant.clientName ?? grant.clientId}
        </p>
        {showUser && (
          <p className="text-[12px] text-ih-fg-3">
            {grant.userEmail ?? grant.userId ?? "Unknown user"}{" "}
            {grant.userRole ? <span className="text-ih-fg-4">({grant.userRole})</span> : null}
          </p>
        )}
        <div className="mt-0.5">
          <ScopesSummary scopes={grant.scopes} />
        </div>
        <p className="text-[11px] text-ih-fg-4 mt-1">
          Created {formatUnixDate(grant.createdAt)}{" "}
          {grant.expiresAt != null
            ? `· Expires ${formatUnixDate(grant.expiresAt)}`
            : "· No expiry"}
        </p>
      </div>
      <button
        type="button"
        onClick={onRequestRevoke}
        className="text-[12px] text-ih-bad-fg hover:underline font-bold shrink-0"
      >
        Revoke
      </button>
    </div>
  );
}

// ─── Page component ───────────────────────────────────────────────────────────

export default function SettingsConnectedApps() {
  const data = useLoaderData<typeof loader>();
  const revokeFetcher = useFetcher<typeof action>();
  const [pendingRevoke, setPendingRevoke] = useState<{
    grant: McpGrant;
    intent: "revoke" | "revoke-admin";
  } | null>(null);
  // Optimistically hide a grant the moment its revoke is submitted, so the row
  // disappears immediately instead of waiting on the loader revalidation.
  const [revokedIds, setRevokedIds] = useState<Set<string>>(new Set());

  // If a revoke fails server-side, restore the row (un-hide it).
  useEffect(() => {
    const result = revokeFetcher.data;
    if (revokeFetcher.state === "idle" && result && result.ok === false && result.id) {
      setRevokedIds((prev) => {
        const next = new Set(prev);
        next.delete(result.id);
        return next;
      });
    }
  }, [revokeFetcher.state, revokeFetcher.data]);

  // Feature-off: MCP not enabled on this deployment.
  if (data.mcpEnabled === false) {
    return (
      <div className="text-center py-16 bg-ih-bg-card border border-ih-border rounded-lg">
        <p className="font-bold text-[14px] text-ih-fg-2">MCP is not enabled on this deployment.</p>
        <p className="text-[12px] text-ih-fg-4 mt-1">Contact your administrator to enable remote MCP access.</p>
      </div>
    );
  }

  const showAdmin = data.all !== null;
  // Hide optimistically-revoked grants from both lists.
  const self = data.self.filter((g) => !revokedIds.has(g.id));
  const all = data.all ? data.all.filter((g) => !revokedIds.has(g.id)) : null;

  return (
    <div className="space-y-[18px]">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-[13px] text-ih-fg-3">
        <Link to="/settings" className="hover:text-ih-primary transition-colors">
          Settings
        </Link>
        <span>&rsaquo;</span>
        <span className="text-ih-fg-1">Connected applications</span>
      </div>

      {/* Heading */}
      <div>
        <h2 className="text-[19px] font-bold text-ih-fg-1">Connected applications</h2>
        <p className="text-[13px] text-ih-fg-3 mt-1">
          MCP clients (e.g. Claude) you&apos;ve authorized to access your data. Revoke
          access at any time.
        </p>
      </div>

      {/* Your applications */}
      <section>
        <h3 className="text-[13px] font-semibold text-ih-fg-3 uppercase tracking-wide mb-2">
          Your applications
        </h3>
        {self.length === 0 ? (
          <div className="text-center py-10 bg-ih-bg-card border border-ih-border rounded-lg">
            <p className="font-bold text-[14px] text-ih-fg-2">No authorized applications yet.</p>
            <p className="text-[12px] text-ih-fg-4 mt-1">
              When you authorize an MCP client (e.g. Claude) it will appear here.
            </p>
          </div>
        ) : (
          <div className="bg-ih-bg-card border border-ih-border rounded-lg divide-y divide-ih-border">
            {self.map((grant) => (
              <GrantRow
                key={grant.id}
                grant={grant}
                onRequestRevoke={() =>
                  setPendingRevoke({ grant, intent: "revoke" })
                }
              />
            ))}
          </div>
        )}
      </section>

      {/* Tenant-wide section (admin only) */}
      {showAdmin && (
        <section>
          <h3 className="text-[13px] font-semibold text-ih-fg-3 uppercase tracking-wide mb-2">
            Tenant-wide authorized applications
          </h3>
          <p className="text-[12px] text-ih-fg-4 mb-3">
            All MCP client authorizations across your team. You can revoke any
            member&apos;s access.
          </p>
          {all!.length === 0 ? (
            <div className="text-center py-10 bg-ih-bg-card border border-ih-border rounded-lg">
              <p className="font-bold text-[14px] text-ih-fg-2">
                No team members have authorized any applications.
              </p>
            </div>
          ) : (
            <div className="bg-ih-bg-card border border-ih-border rounded-lg overflow-hidden">
              {Object.entries(
                all!.reduce<Record<string, McpGrant[]>>((acc, grant) => {
                  const key = grant.userEmail ?? grant.userId ?? "Unknown user";
                  if (!acc[key]) acc[key] = [];
                  acc[key].push(grant);
                  return acc;
                }, {}),
              ).map(([email, grants], idx) => (
                <div key={email} className={idx > 0 ? "border-t border-ih-border" : undefined}>
                  <div className="px-4 py-2 bg-ih-bg-muted">
                    <p className="text-[11px] font-semibold text-ih-fg-3 uppercase tracking-wide">
                      {email}
                    </p>
                  </div>
                  <div className="divide-y divide-ih-border">
                    {grants.map((grant) => (
                      <GrantRow
                        key={grant.id}
                        grant={grant}
                        showUser
                        onRequestRevoke={() =>
                          setPendingRevoke({ grant, intent: "revoke-admin" })
                        }
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Confirm revoke dialog */}
      <ConfirmDialog
        open={!!pendingRevoke}
        title="Revoke access"
        message={
          pendingRevoke
            ? `Revoke "${pendingRevoke.grant.clientName ?? pendingRevoke.grant.clientId}"? The application will lose access immediately.`
            : ""
        }
        confirmLabel="Revoke"
        busy={revokeFetcher.state !== "idle"}
        onConfirm={() => {
          if (pendingRevoke) {
            const id = pendingRevoke.grant.id;
            setRevokedIds((prev) => new Set(prev).add(id));
            revokeFetcher.submit(
              { intent: pendingRevoke.intent, id },
              { method: "POST" },
            );
          }
          setPendingRevoke(null);
        }}
        onCancel={() => setPendingRevoke(null)}
      />
    </div>
  );
}
