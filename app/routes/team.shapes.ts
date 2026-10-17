import { formatRelativeTime } from "~/lib/format";
import { m } from "~/paraglide/messages";
import type { createApi } from "~/lib/api-client.server";
import type { TemplateOption } from "~/components/team/permission-template-ui";

/**
 * What `/team` renders, and the two shapes the API answers with.
 *
 * Split out of `team.tsx` when that file reached its 400-line ceiling. These
 * are the page's DATA definitions — one row as the table sees it, and the two
 * payload shapes the loader maps into it — so they travel together and none of
 * them needs the component to make sense.
 */

export interface Member {
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
  /**
   * Pending rows only — the absolute accept URL, as the SERVER built it.
   *
   * Not composed in the browser from `window.location.origin` + token: the
   * email is sent from the deployment's configured base URL, and where the two
   * differ (a proxy, a preview host, a custom domain) a locally-composed link
   * is the one that does not work. One invitation must have one URL.
   */
  inviteLink: string | null;
  /** Capability toggles differing from the role template; seeds the edit drawer (IA-101). */
  permissionOverrides: Record<string, boolean> | null;
  /** Whether this member has a second factor an owner could clear. */
  totpEnabled: boolean;
}

export interface LoaderActiveUser { id: string; email: string; role: string; name?: string | null; permissionOverrides?: Record<string, boolean> | null; totpEnabled?: boolean; lastActiveAt?: string | null }
export interface LoaderInvite { id: string; email: string; role: string; expiresAt: string; inviteLink?: string }

/**
 * The page's rows from the two lists the API returns: active members first, then
 * pending invitations. Written once here so the loader stays a call and a return.
 */
export function toMembers(users: LoaderActiveUser[], invites: LoaderInvite[]): Member[] {
  const active: Member[] = users.map((u) => ({
    id: u.id, name: u.name ?? null, email: u.email, role: u.role,
    // LAST ACTIVE, layer 2 of 2 — this hardcoded null; layer 1 is the service projection, which explains both.
    status: "active", lastActiveAt: u.lastActiveAt ?? null, token: null, expiresAt: null,
    inviteLink: null,
    permissionOverrides: u.permissionOverrides ?? null,
    totpEnabled: u.totpEnabled === true,
  }));
  const pending: Member[] = invites.map((i) => ({
    id: i.id, name: null, email: i.email, role: i.role,
    status: "pending", lastActiveAt: null, token: i.id, expiresAt: i.expiresAt,
    inviteLink: i.inviteLink ?? null,
    // A pending invite's overrides live on tenant_invites and are replayed
    // at accept time; there is no member row to edit yet.
    permissionOverrides: null,
    // Nobody has enrolled anything until they accept.
    totpEnabled: false,
  }));
  return [...active, ...pending];
}

/**
 * The permission templates to offer, built-in then the company's own. Empty when
 * the caller may not list them (an inspector) or the request fails: the drawers
 * then show the plain role and switches form, and the page claims nothing about
 * which template anyone matches. A failure here must not take the roster with it.
 */
export async function loadTemplates(api: ReturnType<typeof createApi>): Promise<TemplateOption[]> {
  try {
    const res = await api.team["permission-templates"].$get();
    if (!res.ok) return [];
    const body = (await res.json()) as unknown as { data?: { templates?: TemplateOption[] } };
    return body.data?.templates ?? [];
  } catch {
    return [];
  }
}

export const ROLE_TONES: Record<string, "primary" | "info" | "neutral" | "warning" | "monitor" | "sat" | "gen"> = {
  owner: "primary",
  manager: "info",
  inspector: "neutral",
  staff: "gen",
  lead: "info",
  specialist: "sat",
  agent: "warning",
  office: "gen",
};

/**
 * The LAST ACTIVE cell's text: a relative "5 minutes ago" from the serialised
 * `users.last_active_at`, or an em dash when there is nothing to show.
 *
 * An em dash is the honest answer for exactly two rows — a pending invite
 * (nobody has signed in yet) and a member who has not made a request since the
 * column was introduced. It used to be the answer for EVERY row, at every
 * moment, because neither the service projection nor the loader carried the
 * value; the dash was therefore not reporting an absence, it was reporting its
 * own two dropped mappings.
 *
 * `now` is injected so a test can pin the gap rather than assert on wall clock.
 */
export function lastActiveLabel(
  iso: string | null,
  locale: string,
  now?: number,
): string {
  if (!iso) return "—";
  return formatRelativeTime(iso, now === undefined ? { locale } : { locale, now }) || "—";
}

/**
 * Human "expires in Nd" / "expired Nd ago" from an ISO expiry. Whole-day
 * granularity is enough for a 7-day invite window.
 *
 * Called during render rather than at module scope so the message resolves in
 * the request's locale, not whichever one was current at import.
 */
export function expiryLabel(iso: string | null): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - Date.now();
  const days = Math.round(Math.abs(ms) / 86_400_000);
  if (ms <= 0) return m.settings_team_invite_expired({ days });
  return m.settings_team_invite_expires_in({ days });
}

/**
 * Whether the viewer is offered "Remove" on an active member's row.
 *
 * Never on the viewer's own row (the API answers a self-removal with a 400),
 * and never when the viewer's identity is unknown: with no email to compare,
 * every row would look like somebody else's. An owner row is offered only to
 * an owner, because the API refuses a manager the removal of an owner.
 */
export function canRemove(member: Pick<Member, "email" | "role">, viewerEmail: string | null | undefined, viewerIsOwner: boolean): boolean {
  if (!viewerEmail) return false;
  if (member.email.toLowerCase() === viewerEmail.toLowerCase()) return false;
  return viewerIsOwner || member.role !== "owner";
}
