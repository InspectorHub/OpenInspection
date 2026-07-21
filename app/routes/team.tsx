import { useState } from "react";
import { useLoaderData, useFetcher } from "react-router";
import type { Route } from "./+types/team";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { SeatBanner } from "~/components/SeatBanner";
import { InviteSeatDrawer } from "~/components/modals/InviteSeatDrawer";
import { ConfirmDialog } from "~/components/ConfirmDialog";
import { useSessionContext } from "~/hooks/useSessionContext";
import { Breadcrumb } from "~/components/Breadcrumb";
import { PageHeader, TabStrip, Card, Pill, Button, EmptyState, Table } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

export function meta() {
  return [{ title: m.settings_team_meta_title() }];
}

interface Member {
  id: string;
  name: string | null;
  email: string;
  role: string;
  status: "active" | "pending";
  lastActiveAt: string | null;
  /** Present only on pending rows — the tenant_invites token to cancel/resend. */
  token: string | null;
  /** Present only on pending rows — ISO expiry for the "expires in Nd" label. */
  expiresAt: string | null;
}

interface LoaderActiveUser { id: string; email: string; role: string; name?: string | null }
interface LoaderInvite { id: string; email: string; role: string; expiresAt: string }

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  const api = createApi(context, { token });

  // Resolve the caller role so the cancel affordance is hidden for inspectors
  // (server enforces owner/manager regardless — this is just UI hygiene).
  let role: string | undefined;
  try {
    const ctxRes = await api.sessionContext.context.$get();
    if (ctxRes.ok) {
      const b = (await ctxRes.json()) as { data?: { user?: { role?: string } } };
      role = b.data?.user?.role;
    }
  } catch {
    role = undefined;
  }

  try {
    const res = await api.team.members.$get();
    const body = res.ok
      ? ((await res.json()) as unknown as { data?: { members?: LoaderActiveUser[]; invites?: LoaderInvite[] } })
      : { data: { members: [], invites: [] } };
    const active: Member[] = (body.data?.members ?? []).map((u) => ({
      id: u.id, name: u.name ?? null, email: u.email, role: u.role,
      status: "active", lastActiveAt: null, token: null, expiresAt: null,
    }));
    const pending: Member[] = (body.data?.invites ?? []).map((i) => ({
      id: i.id, name: null, email: i.email, role: i.role,
      status: "pending", lastActiveAt: null, token: i.id, expiresAt: i.expiresAt,
    }));
    return { members: [...active, ...pending], canManage: role === "owner" || role === "manager" };
  } catch {
    return { members: [] as Member[], canManage: false };
  }
}

export async function action({ request, context }: Route.ActionArgs) {
  const token = await requireToken(context, request);
  const form = await request.formData();
  const intent = form.get("intent") as string;
  const api = createApi(context, { token });

  if (intent === "cancel-invite") {
    const inviteToken = form.get("token") as string;
    const res = await api.team.invites[":token"].$delete({ param: { token: inviteToken } });
    return { ok: res.ok };
  }
  if (intent === "resend-invite") {
    const inviteToken = form.get("token") as string;
    const res = await api.team.invites[":token"].resend.$post({ param: { token: inviteToken } });
    return { ok: res.ok, resent: res.ok };
  }
  return { ok: false };
}

const ROLE_TONES: Record<string, "primary" | "info" | "neutral" | "warning" | "monitor" | "sat" | "gen"> = {
  owner: "primary",
  manager: "info",
  inspector: "neutral",
  lead: "info",
  specialist: "sat",
  agent: "warning",
  office: "gen",
};

export default function TeamPage() {
  const { members, canManage } = useLoaderData<typeof loader>();
  const cancelFetcher = useFetcher<{ ok?: boolean }>();
  const resendFetcher = useFetcher<{ ok?: boolean; resent?: boolean }>();
  const [pendingCancel, setPendingCancel] = useState<{ token: string; email: string } | null>(null);
  const sessionCtx = useSessionContext();
  const [activeTab, setActiveTab] = useState("active");
  const [inviteOpen, setInviteOpen] = useState(false);

  // Human "expires in Nd" / "expired Nd ago" from an ISO expiry. Whole-day
  // granularity is enough for a 7-day invite window.
  function expiryLabel(iso: string | null): string {
    if (!iso) return "";
    const ms = new Date(iso).getTime() - Date.now();
    const days = Math.round(Math.abs(ms) / 86_400_000);
    if (ms <= 0) return m.settings_team_invite_expired({ days });
    return m.settings_team_invite_expires_in({ days });
  }

  // Built in the render (request ALS scope) so the labels resolve per-request
  // rather than freezing the locale at module import.
  const TABS = [
    { id: "active", label: m.settings_team_tab_active() },
    { id: "pending", label: m.settings_team_tab_pending() },
  ];

  const filtered = members.filter((m) => {
    if (activeTab === "active") return m.status !== "pending";
    if (activeTab === "pending") return m.status === "pending";
    return true;
  });

  // Reuse the same sessionCtx.seatUsage the SeatBanner below already consumes
  // (no extra API call) to gate the invite modal at open — see
  // InviteSeatDrawer's `seatLimitAtOpen` doc comment. `seatUsage` is null for
  // unlimited deployments, so `atCapSeatUsage` stays undefined (normal
  // invite form) in that case; the server's 402 SEAT_LIMIT_REACHED remains
  // the authoritative backstop for races.
  const billingUrl = sessionCtx?.branding?.portalBaseUrl ? `${sessionCtx.branding.portalBaseUrl}/billing` : undefined;
  const atCapSeatUsage =
    sessionCtx?.seatUsage && sessionCtx.seatUsage.used >= sessionCtx.seatUsage.limit
      ? { used: sessionCtx.seatUsage.used, max: sessionCtx.seatUsage.limit, billingUrl }
      : undefined;

  return (
    <div className="space-y-ih-list">
      {/* F3 — Seat quota banner */}
      {sessionCtx?.seatUsage && (
        <SeatBanner usage={sessionCtx.seatUsage} billingUrl={billingUrl} />
      )}

      <Breadcrumb
        items={[
          { label: m.settings_crumb_settings(), href: "/settings" },
          { label: m.settings_team_crumb() },
        ]}
      />

      <PageHeader
        title={m.settings_team_heading()}
        meta={`${members.length} ${members.length === 1 ? m.settings_team_member_singular() : m.settings_team_member_plural()}`}
        actions={
          <Button variant="primary" icon={<PlusIcon />} onClick={() => setInviteOpen(true)}>
            {m.settings_team_invite_button()}
          </Button>
        }
      />

      <InviteSeatDrawer open={inviteOpen} onClose={() => setInviteOpen(false)} seatLimitAtOpen={atCapSeatUsage} />

      <TabStrip tabs={TABS} activeId={activeTab} onChange={setActiveTab} />

      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            title={activeTab === "pending" ? m.settings_team_empty_pending_title() : m.settings_team_empty_active_title()}
            description={m.settings_team_empty_desc()}
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <Table<Member>
            rows={filtered}
            getRowKey={(m) => m.id}
            columns={[
              {
                label: m.settings_team_col_name(),
                cell: (member) => (
                  <>
                    <p className="text-[13px] font-medium text-ih-fg-1">{member.name || m.settings_team_member_unnamed()}</p>
                    <p className="text-[11px] text-ih-fg-3">{member.email}</p>
                  </>
                ),
              },
              { label: m.settings_team_col_role(), cell: (member) => <Pill tone={ROLE_TONES[member.role] || "gen"}>{member.role}</Pill> },
              {
                label: m.settings_team_col_status(),
                cell: (member) => (
                  <span className={`inline-flex items-center gap-1.5 text-[12px] font-medium ${
                    member.status === "active" ? "text-ih-ok-fg" : "text-ih-watch-fg"
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${member.status === "active" ? "bg-ih-ok" : "bg-ih-watch"}`} />
                    {member.status === "active" ? m.settings_team_status_active() : m.settings_team_status_pending()}
                  </span>
                ),
              },
              { label: m.settings_team_col_last_active(), cell: (member) => <span className="text-ih-fg-3">{member.lastActiveAt || "—"}</span> },
              {
                label: "",
                align: "right",
                cell: (member) =>
                  member.status === "pending" && member.token ? (
                    <div className="flex items-center justify-end gap-3">
                      <span className={`text-[11px] ${
                        member.expiresAt && new Date(member.expiresAt).getTime() <= Date.now()
                          ? "text-ih-bad-fg" : "text-ih-fg-4"
                      }`}>
                        {expiryLabel(member.expiresAt)}
                      </span>
                      {canManage && (
                        <>
                          <resendFetcher.Form method="post" className="inline">
                            <input type="hidden" name="intent" value="resend-invite" />
                            <input type="hidden" name="token" value={member.token} />
                            <button type="submit" disabled={resendFetcher.state !== "idle"} className="text-[12px] font-medium text-ih-primary hover:underline disabled:opacity-50">
                              {m.settings_team_resend_invite()}
                            </button>
                          </resendFetcher.Form>
                          <button
                            type="button"
                            onClick={() => setPendingCancel({ token: member.token as string, email: member.email })}
                            className="text-[12px] font-medium text-ih-bad-fg hover:underline"
                          >
                            {m.settings_team_cancel_invite()}
                          </button>
                        </>
                      )}
                    </div>
                  ) : member.status === "active" ? (
                    <button className="text-[12px] font-medium text-ih-fg-3 hover:text-ih-fg-1">
                      {m.common_edit()}
                    </button>
                  ) : null,
              },
            ]}
          />
        </Card>
      )}

      {/* Roles reference */}
      <Card className="p-6">
        <h2 className="text-sm font-bold text-ih-fg-1 mb-3">{m.settings_team_roles_heading()}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            { role: m.settings_team_role_owner_name(), desc: m.settings_team_role_owner_desc() },
            { role: m.settings_team_role_manager_name(), desc: m.settings_team_role_manager_desc() },
            { role: m.settings_team_role_inspector_name(), desc: m.settings_team_role_inspector_desc() },
            { role: m.settings_team_role_agent_name(), desc: m.settings_team_role_agent_desc() },
          ].map((r) => (
            <div key={r.role} className="p-3 border border-ih-border rounded-md">
              <p className="text-[13px] font-bold text-ih-fg-1">{r.role}</p>
              <p className="text-[12px] text-ih-fg-3 mt-0.5">{r.desc}</p>
            </div>
          ))}
        </div>
      </Card>

      <ConfirmDialog
        open={pendingCancel !== null}
        title={m.settings_team_cancel_invite_title()}
        message={pendingCancel ? m.settings_team_cancel_invite_confirm({ email: pendingCancel.email }) : ""}
        confirmLabel={m.settings_team_cancel_invite()}
        busy={cancelFetcher.state !== "idle"}
        onConfirm={() => {
          if (pendingCancel) {
            cancelFetcher.submit(
              { intent: "cancel-invite", token: pendingCancel.token },
              { method: "post" },
            );
            setPendingCancel(null);
          }
        }}
        onCancel={() => setPendingCancel(null)}
      />
    </div>
  );
}

function PlusIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
    </svg>
  );
}
