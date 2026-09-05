import { useState } from "react";
import { Link, useLoaderData, useFetcher } from "react-router";
import type { Route } from "./+types/team";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { SeatBanner } from "~/components/SeatBanner";
import { InviteSeatDrawer } from "~/components/modals/InviteSeatDrawer";
import { EditMemberDrawer, type EditableMember } from "~/components/modals/EditMemberDrawer";
import { ConfirmDialog } from "~/components/ConfirmDialog";
import { InviteLinkModal, type InviteLinkTarget } from "~/components/modals/InviteLinkModal";
import { ResetTwoFactorDialog, type ResetTwoFactorTarget } from "~/components/modals/ResetTwoFactorDialog";
import { resetMemberTwoFactor } from "./team.reset-two-factor.server";
import { useSessionContext } from "~/hooks/useSessionContext";
import { importEntryHref } from "~/lib/import-entry-points";
import { Breadcrumb } from "~/components/Breadcrumb";
import { PageHeader, TabStrip, Card, Pill, Button, EmptyState, Table, Banner } from "@core/shared-ui";
import { useGuardedSubmit } from "~/hooks/useGuardedSubmit";
import { m } from "~/paraglide/messages";
import { isAdminRole } from "~/lib/access";
import { ROLE_TONES, expiryLabel, type Member, type LoaderActiveUser, type LoaderInvite } from "./team.shapes";

export function meta() {
  return [{ title: m.settings_team_meta_title() }];
}


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

  // IA-118 — a fetch failure must not be answered with an empty roster. This
  // page states who has access to the workspace; "no members" is a claim, and
  // rendering it because a request failed is the same defect that told an
  // operator a contact "cannot open any reports" while they held two live
  // links. Note also that `res.ok === false` used to fall through to the SAME
  // empty shape as success, so a 500 and an empty team were indistinguishable.
  let loadFailed = false;
  try {
    const res = await api.team.members.$get();
    if (!res.ok) throw new Error(`team members ${res.status}`);
    const body = (await res.json()) as unknown as { data?: { members?: LoaderActiveUser[]; invites?: LoaderInvite[] } };
    const active: Member[] = (body.data?.members ?? []).map((u) => ({
      id: u.id, name: u.name ?? null, email: u.email, role: u.role,
      status: "active", lastActiveAt: null, token: null, expiresAt: null,
      inviteLink: null,
      permissionOverrides: u.permissionOverrides ?? null,
      totpEnabled: u.totpEnabled === true,
    }));
    const pending: Member[] = (body.data?.invites ?? []).map((i) => ({
      id: i.id, name: null, email: i.email, role: i.role,
      status: "pending", lastActiveAt: null, token: i.id, expiresAt: i.expiresAt,
      inviteLink: i.inviteLink ?? null,
      // A pending invite's overrides live on tenant_invites and are replayed
      // at accept time; there is no member row to edit yet.
      permissionOverrides: null,
      // Nobody has enrolled anything until they accept.
      totpEnabled: false,
    }));
    return { members: [...active, ...pending], canManage: isAdminRole(role), isOwner: role === "owner", loadFailed };
  } catch {
    // `canManage` is derived from the JWT role, which was resolved BEFORE this
    // try block and is not in doubt. Returning false here downgraded an owner's
    // permissions because a list request failed — the page then hid the manage
    // affordances, which reads as "you are not allowed" rather than "we could
    // not load this".
    loadFailed = true;
    return { members: [] as Member[], canManage: isAdminRole(role), isOwner: role === "owner", loadFailed };
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
  if (intent === "reset-two-factor") {
    return resetMemberTwoFactor(api, form.get("id") as string);
  }
  if (intent === "resend-invite") {
    const inviteToken = form.get("token") as string;
    const res = await api.team.invites[":token"].resend.$post({ param: { token: inviteToken } });
    return { ok: res.ok, resent: res.ok };
  }
  return { ok: false };
}


export default function TeamPage() {
  const { members, canManage, isOwner, loadFailed } = useLoaderData<typeof loader>();
  // #106 - cancelling an invite burns the token; a second cancel would 404
  // and read as a failure. `resendFetcher` below is a <Form>, not a submit.
  const { submit: submitCancel, busy: cancelBusy } = useGuardedSubmit<{ ok?: boolean }>();
  // The owner's two-factor reset. Its own submit rather than sharing the
  // cancel-invite one: two dialogs sharing a busy flag disable each other, and
  // a reset that silently rode a cancel's in-flight guard would be dropped.
  const { submit: submitResetTwoFactor, busy: resetTwoFactorBusy } = useGuardedSubmit<{ ok?: boolean }>();
  const [pendingReset, setPendingReset] = useState<ResetTwoFactorTarget | null>(null);
  const resendFetcher = useFetcher<{ ok?: boolean; resent?: boolean }>();
  const [pendingCancel, setPendingCancel] = useState<{ token: string; email: string } | null>(null);

  // Which pending invite's link is on screen. The dialog itself is
  // `InviteLinkModal`, which owns why it SHOWS the URL rather than only
  // copying it.
  const [linkInvite, setLinkInvite] = useState<InviteLinkTarget | null>(null);
  const sessionCtx = useSessionContext();
  const [activeTab, setActiveTab] = useState("active");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editMember, setEditMember] = useState<EditableMember | null>(null);


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

      {/* IA-118 — an empty roster is a statement about who can reach this
          workspace. Say when it is not a real answer. */}
      {loadFailed && <Banner tone="danger">{m.settings_team_load_failed()}</Banner>}

      <PageHeader
        title={m.settings_team_heading()}
        meta={`${members.length} ${members.length === 1 ? m.settings_team_member_singular() : m.settings_team_member_plural()}`}
        actions={
          <div className="flex items-center gap-2">
            {/* Secondary first, primary second — the order /contacts and
                /templates already use. The bulk entrance does NOT pre-judge
                seats: a greyed-out link here could not say "this file needs 12
                and 3 are free", and that sentence is the Import step's to say,
                once the file has been read and counted. */}
            <Link
              to={importEntryHref("members.invite")}
              className="h-9 px-3 rounded-md border border-ih-border text-[13px] font-medium text-ih-fg-2 hover:bg-ih-bg-muted inline-flex items-center"
            >
              {m.settings_team_import_button()}
            </Link>
            <Button variant="primary" icon={<PlusIcon />} onClick={() => setInviteOpen(true)}>
              {m.settings_team_invite_button()}
            </Button>
          </div>
        }
      />

      <InviteSeatDrawer open={inviteOpen} onClose={() => setInviteOpen(false)} seatLimitAtOpen={atCapSeatUsage} />
      <EditMemberDrawer open={editMember !== null} onClose={() => setEditMember(null)} member={editMember} />

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
                          {/* The invite link, which the server has returned on
                              creation since the endpoint was written and which
                              nothing has ever shown. It lives on the ROW rather
                              than in the create drawer because the drawer is
                              transient — close it and the link is gone — while
                              this row is where someone comes back to ask "what
                              about that invitation".

                              It is also what makes the drawer's "send email"
                              checkbox honourable: an invite created without an
                              email is only quiet rather than broken if the
                              inviter can still fetch the link. */}
                          {member.inviteLink && (
                            <button
                              type="button"
                              onClick={() => setLinkInvite({ url: member.inviteLink as string, email: member.email })}
                              className="text-[12px] font-medium text-ih-primary-text hover:underline"
                            >
                              {m.settings_team_invite_link_action()}
                            </button>
                          )}
                          <resendFetcher.Form method="post" className="inline">
                            <input type="hidden" name="intent" value="resend-invite" />
                            <input type="hidden" name="token" value={member.token} />
                            <button type="submit" disabled={resendFetcher.state !== "idle"} className="text-[12px] font-medium text-ih-primary-text hover:underline disabled:opacity-50">
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
                  ) : member.status === "active" && canManage ? (
                    // IA-101 — this button existed with no onClick. The only
                    // way to fix a role was to remove the member and re-invite.
                    //
                    // `canManage` matters MORE now than it did before. While the
                    // button was inert it was merely decorative for everyone;
                    // wiring it up without this gate would walk an inspector
                    // through a whole drawer and then 403 on save. The API
                    // enforces owner/manager regardless — this stops us
                    // offering an action we know will be refused.
                    <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setEditMember({
                        id: member.id as string,
                        name: member.name as string | null,
                        email: member.email,
                        role: member.role as string,
                        permissionOverrides: (member.permissionOverrides ?? null) as Record<string, boolean> | null,
                      })}
                      className="text-[12px] font-medium text-ih-fg-3 hover:text-ih-fg-1"
                    >
                      {m.common_edit()}
                    </button>
                      {/* OWNER ONLY, and only where there is something to
                          clear. This is the one action that lowers another
                          person's authentication requirement, so it is not on
                          the wider admin tier — and offering it on a member
                          with no enrolment would answer with a refusal the
                          owner could have been spared. */}
                      {isOwner && member.totpEnabled === true && (
                        <button
                          type="button"
                          onClick={() => setPendingReset({ id: member.id as string, email: member.email })}
                          className="text-[12px] font-medium text-ih-fg-3 hover:text-ih-fg-1"
                        >
                          {m.settings_team_reset_two_factor()}
                        </button>
                      )}
                    </div>
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
        busy={cancelBusy}
        onConfirm={() => {
          if (pendingCancel) {
            if (
              submitCancel(
                { intent: "cancel-invite", token: pendingCancel.token },
                { method: "post" },
              )
            ) {
              setPendingCancel(null);
            }
          }
        }}
        onCancel={() => setPendingCancel(null)}
      />
      <ResetTwoFactorDialog
        target={pendingReset}
        busy={resetTwoFactorBusy}
        onConfirm={(target) => {
          if (submitResetTwoFactor({ intent: "reset-two-factor", id: target.id }, { method: "post" })) {
            setPendingReset(null);
          }
        }}
        onCancel={() => setPendingReset(null)}
      />
      {/* Keyed on the URL so the Copy button's "Link copied" state cannot
          survive into the NEXT invitation's dialog and claim a copy that was
          never made for it. */}
      <InviteLinkModal key={linkInvite?.url ?? ""} target={linkInvite} onClose={() => setLinkInvite(null)} />
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
